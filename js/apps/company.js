/* Company & HR (Bitrix24 "Employees"): directory, company structure, leave requests with approval, absence chart,
   worktime (clock in/out + monthly report), work schedules, work reports, meetings & briefings.
   Exposes Apps.HR (works without the app open) and Apps.Company (clock helpers used by js/home.js). */
(function () {
  const { h, esc } = UI;
  const ABS = { vacation: ["🌴 Vacation", "#10b981"], sick: ["🤒 Sick leave", "#ef4444"], personal: ["🏠 Personal", "#f59e0b"], remote: ["💻 Remote", "#3b82f6"], trip: ["✈️ Business trip", "#8b5cf6"] };
  const entryId = (who, d) => (who + "_" + d).replace(/[^\w@.-]/g, "_");
  const worked = e => { if (!e?.start) return 0; const end = e.end || Date.now(); const paused = (e.pauses || []).reduce((a, p) => a + ((p.e || (e.end ? e.end : Date.now())) - p.s), 0); return Math.max(0, end - e.start - paused); };
  const hm = ms => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const state = e => !e?.start ? "off" : e.end ? "done" : (e.pauses || []).some(p => !p.e) ? "paused" : "working";

  /* ---------- small helpers ---------- */
  const ME = () => Data.me().key;
  const T = () => Apps.today();
  const PALETTE = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
  const isAdmin = () => { try { return Apps.isAdmin ? !!Apps.isAdmin() : true; } catch { return true; } };
  const stat = a => a.status || "approved"; // old absences have no status: they were approved
  const covers = (a, d) => a.from <= d && (a.to || a.from) >= d;
  const dmId = k => "dm:" + [ME(), k].sort().join("|");
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  // workspace settings (js/prefs.js): business hours (weekend, holidays, start/end), Tools → Company tabs, region, phone country code
  const hrs = () => (window.Prefs ? Prefs.get("hours") : null) || { start: "09:00", end: "18:00", weekend: [0, 6], holidays: [] };
  const okHM = (v, d) => /^\d{1,2}:\d{2}$/.test(v || "") ? v : d;
  const dayStart = () => okHM(hrs().start, "09:00"), dayEnd = () => okHM(hrs().end, "18:00");
  const weekendDays = () => Array.isArray(hrs().weekend) ? hrs().weekend : [0, 6];
  const isHoliday = d => (Array.isArray(hrs().holidays) ? hrs().holidays : []).some(x => x && x.date === d);
  const toolOn = f => !window.Prefs || Prefs.tool("company", f);
  const TAB_FEATURE = { structure: "structure", requests: "absence", absence: "absence", worktime: "worktime", schedules: "schedules", reports: "reports", meetings: "meetings" };
  const tabOn = k => !TAB_FEATURE[k] || toolOn(TAB_FEATURE[k]);
  const fmtHM = hm => { if (!hm) return hm || ""; try { const r = Apps.fmtTime?.(hm); if (r && !/invalid|nan/i.test(r)) return r; } catch {} return hm; };
  const span2 = (a, b) => fmtHM(a) + "–" + fmtHM(b);
  const phonePrefix = () => { const c = String((window.Prefs && Prefs.get("people.phoneCountry")) || "").trim().replace(/[^\d+]/g, ""); return /^\+?\d{1,4}$/.test(c) ? "+" + c.replace("+", "") + " " : ""; };
  const fmtT = ms => { try { const r = Apps.fmtTime?.(ms); if (r && !/invalid|nan/i.test(r)) return r; } catch {} return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const fmtN = n => String(Math.round(n * 10) / 10);
  const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many || one + "s"}`;
  const nonEmpty = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== "" && v != null));
  const enrich = p => ({ ...(Data.get("people", p.key) || {}), ...nonEmpty(p), key: p.key }); // adds stored fields (joined, birthday…) to Data.people() entries
  const ppl = () => Data.people().map(enrich).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const full = k => enrich(Data.person(k));
  const first = k => String(Data.person(k).name || "").split(" ")[0];
  const range = (a, b) => !b || a === b ? Apps.fmtDate(a) : Apps.fmtDate(a) + " – " + Apps.fmtDate(b);
  const monday = d => { const x = new Date((d || T()) + "T00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return Apps.iso(x); };
  const dow = d => new Date(d + "T00:00").getDay();
  // working day: not a weekend day and not a holiday (Settings → Business hours)
  const isWork = d => !weekendDays().includes(dow(d)) && !isHoliday(d);
  const daysBetween = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = Apps.addDays(d, 1)) out.push(d); return out; };
  const monthDays = m => { const y = m.getFullYear(), mo = m.getMonth(), n = new Date(y, mo + 1, 0).getDate(); return Array.from({ length: n }, (_, i) => Apps.iso(new Date(y, mo, i + 1))); };
  const dayShort = d => new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const mdLong = md => new Date("2000-" + md + "T00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const STAT = { pending: ["Pending", "orange"], approved: ["Approved", "green"], declined: ["Declined", "red"], sent: ["Waiting for review", "blue"], returned: ["Returned", "red"],
    planned: ["Planned", "blue"], held: ["Held", "green"], cancelled: ["Cancelled", "gray"] };
  const stTag = s => h("span", { class: "tag co-st", dataset: { tc: STAT[s]?.[1] || "gray" }, text: STAT[s]?.[0] || s });
  const stars = n => h("span", { class: "co-stars", title: n + " of 5", text: "★".repeat(n) + "☆".repeat(5 - n) });
  const openTask = id => Apps.Tasks?.openTask ? Apps.Tasks.openTask(id) : Apps.go("tasks", id);
  const jitsi = () => `https://meet.jit.si/Lumen-${String(window.Cloud?.ws?.id || "local").replace(/[^\w-]/g, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  function download(name, rows) {
    const s = rows.map(r => r.map(c => { c = String(c ?? ""); return /[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + s], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // a modal with free-form content and Save / Cancel (/ Delete)
  function dialog(title, content, { ok = "Save", onOk, onDelete, width = 520 } = {}) {
    const save = h("button", { class: "btn primary", type: "button", text: ok });
    const m = UI.modal(title, h("div", { class: "co-dlg" }, content,
      h("div", { class: "f-actions" }, onDelete ? h("button", { class: "btn danger", type: "button", text: "Delete", onclick: async () => { if (await UI.confirm("Delete this permanently?")) { m.close(); onDelete(); } } }) : h("span"),
        h("span", { class: "co-acts" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => m.close() }), save))));
    save.onclick = async () => { if ((await onOk?.()) !== false) m.close(); };
    m.el.style.width = width + "px"; m.el.style.maxWidth = "calc(100vw - 24px)";
    return m;
  }
  // a form row; only plain inputs get a <label> (a label around buttons or checkboxes would click them)
  const field = (label, ctl, half) => h(/^(INPUT|SELECT|TEXTAREA)$/.test(ctl.tagName) ? "label" : "div", { class: "f-row" + (half ? " half" : "") }, h("span", { text: label }), ctl);
  const input = (type, value, attrs = {}) => { const el = h("input", { class: "menu-input", type, ...attrs }); el.value = value ?? ""; return el; };

  /* ---------- settings "org": departments, leave allowance, work report rules ---------- */
  const org = () => Data.get("settings", "org") || {};
  const saveOrg = patch => Data.update("settings", "org", patch);
  const DEFAULT_ALLOW = { vacation: 24, sick: 10, personal: 5, remote: 0, trip: 0 };
  const allowance = () => ({ ...DEFAULT_ALLOW, ...(org().allowance || {}) });
  const repCfg = () => ({ period: "week", remind: true, ...(org().reports || {}) });
  const slug = s => "d-" + String(s).toLowerCase().replace(/[^\w]+/g, "-").slice(0, 40);

  // stored departments plus any department name people use that isn't in the list yet
  function departments() {
    const stored = Array.isArray(org().departments) ? org().departments.filter(d => d && d.id && d.name) : [];
    const out = stored.map(d => ({ id: d.id, name: d.name, parent: d.parent || null, head: d.head || null }));
    const names = new Set(out.map(d => d.name));
    Data.people().forEach(p => { if (p.dept && !names.has(p.dept)) { names.add(p.dept); out.push({ id: slug(p.dept), name: p.dept, parent: null, head: null, derived: true }); } });
    return out;
  }
  const deptByName = n => departments().find(d => d.name === n) || null;
  const headOf = name => deptByName(name)?.head || null;
  // head of the person's department; if they lead it themselves (or it has no head), the head of a parent department
  function managerOf(key) {
    const all = departments();
    let d = all.find(x => x.name === Data.person(key)?.dept);
    for (let i = 0; d && i < 40; i++) {
      if (d.head && d.head !== key) return d.head;
      const parent = d.parent; d = parent ? all.find(x => x.id === parent) : null;
    }
    return null;
  }
  const outRec = (key, d = T()) => Data.list("absences").find(a => a.who === key && stat(a) === "approved" && covers(a, d)) || null;
  const isOut = (key, d = T()) => !!outRec(key, d);
  // department names led by someone, including all sub-departments
  function ledDepts(key = ME()) {
    const all = departments(), ids = new Set();
    const add = id => { if (ids.has(id)) return; ids.add(id); all.filter(x => x.parent === id).forEach(x => add(x.id)); };
    all.filter(d => d.head === key).forEach(d => add(d.id));
    return all.filter(d => ids.has(d.id)).map(d => d.name);
  }
  const isHead = (key = ME()) => departments().some(d => d.head === key);
  const canManage = who => isAdmin() || ledDepts().includes(Data.person(who).dept); // shifts, worktime
  const team = () => isAdmin() ? ppl() : (led => ppl().filter(p => p.key === ME() || led.includes(p.dept)))(ledDepts());
  function admins() {
    const keys = Data.people().map(p => p.key);
    if (Apps.isAdmin) { try { const a = keys.filter(k => Apps.isAdmin(k)); if (a.length) return a; } catch {} }
    const o = String(window.Cloud?.ws?.ownerEmail || "").toLowerCase();
    return o ? [o] : keys.slice(0, 1);
  }
  function approverFor(key) {
    const m = managerOf(key); if (m) return m;
    const a = admins(); return a.find(k => k !== key) || a[0] || key;
  }
  // working days (weekend and holidays from Settings → Business hours excluded) an absence takes, optionally only those inside one year
  function workDays(a, year) {
    let from = a.from, to = a.to && a.to > a.from ? a.to : a.from;
    if (!from) return 0;
    if (a.half && from === to) return isWork(from) && (!year || from.startsWith(year)) ? 0.5 : 0;
    if (year) { if (from < year + "-01-01") from = year + "-01-01"; if (to > year + "-12-31") to = year + "-12-31"; }
    return from > to ? 0 : daysBetween(from, to).filter(isWork).length;
  }
  function balance(key, year = String(new Date().getFullYear())) {
    const allow = allowance(), mine = Data.list("absences").filter(a => a.who === key && stat(a) !== "declined");
    return Object.keys(ABS).map(type => {
      const of = mine.filter(a => a.type === type);
      const used = of.filter(a => stat(a) === "approved").reduce((s, a) => s + workDays(a, year), 0);
      const pending = of.filter(a => stat(a) === "pending").reduce((s, a) => s + workDays(a, year), 0);
      const total = +allow[type] || 0;
      return { type, total, used, pending, left: total ? total - used : null };
    });
  }

  /* ---------- shifts ---------- */
  const templates = () => Data.list("shifts").filter(s => s.kind === "template").sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.name).localeCompare(String(b.name)));
  const shiftId = (who, d) => ("sh_" + who + "_" + d).replace(/[^\w@.-]/g, "_");
  const shiftOf = (who, d) => Data.get("shifts", shiftId(who, d)) || Data.list("shifts").find(s => s.kind === "shift" && s.who === who && s.date === d) || null;
  const shiftIndex = () => { const m = new Map(); Data.list("shifts").forEach(s => { if (s.kind === "shift") m.set(s.who + "|" + s.date, s); }); return m; };
  const setShift = (who, date, s) => Data.add("shifts", { kind: "shift", who, date, start: s.start, finish: s.finish, template: s.template || null, note: s.note || "" }, shiftId(who, date));
  // minutes late vs the planned shift (only counts when more than 10 minutes)
  function lateBy(e, sh) {
    if (!e?.start || !sh?.start) return 0;
    const st = new Date(e.start), m = st.getHours() * 60 + st.getMinutes() - toMin(sh.start);
    return m > 10 ? m : 0;
  }

  /* ---------- reports ---------- */
  const hasReport = (who, wk) => Data.list("reports").some(r => r.who === who && r.from <= Apps.addDays(wk, 6) && (r.to || r.from) >= wk);
  function periodLabel(r) {
    if (r.period === "day") return new Date(r.from + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (r.period === "month") return new Date(r.from + "T00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return "Week of " + Apps.fmtDate(r.from);
  }

  /* ---------- meetings ---------- */
  const canSeeMeeting = m => isAdmin() || m.chair === ME() || m.by === ME() || (m.attendees || []).includes(ME());
  const canEditMeeting = m => isAdmin() || m.chair === ME() || m.by === ME();
  const canWriteMeeting = m => canEditMeeting(m) || (m.attendees || []).includes(ME());
  const meetPeople = m => [...new Set([m.chair, ...(m.attendees || [])])].filter(Boolean);
  const timeRange = m => m.start ? fmtHM(m.start) + (m.finish ? "–" + fmtHM(m.finish) : "") : "All day";

  /* ======================================================================
     Shared actions (used from several tabs and from other apps)
     ====================================================================== */
  async function editProfile() {
    const me = Data.me(), cur = Data.get("people", me.key) || {};
    const names = [...new Set([...departments().map(d => d.name), cur.dept].filter(Boolean))].sort();
    const dept = names.length ? { key: "dept", label: "Department", type: "select", half: true, options: [["", "No department"], ...names.map(n => [n, n])] } : { key: "dept", label: "Department", half: true };
    const v = await Apps.form("My profile", [{ key: "avatar", label: "Avatar", type: "avatar", photo: me.photo, person: me }, { key: "name", label: "Name", required: true }, { key: "title", label: "Job title", half: true }, dept,
      { key: "phone", label: "Phone", type: "tel", half: true }, { key: "birthday", label: "Birthday", type: "date", half: true }, { key: "joined", label: "Joined on", type: "date", half: true },
      { key: "about", label: "About me", type: "textarea", rows: 3 }], { name: me.name, ...cur, phone: String(cur.phone || "").trim() || phonePrefix(), dept: cur.dept || "", avatar: me.avatar || "" }, { width: 560 });
    if (!v) return;
    if (phonePrefix() && String(v.phone || "").trim() === phonePrefix().trim()) v.phone = "";
    const pick = ["title", "dept", "phone", "birthday", "joined", "about"], nm = String(v.name ?? "").trim();
    // shared workspace: the typed name is stored as `alias` (the account name in `name` is refreshed from Google on every sign-in)
    const naming = me.accountName ? { alias: nm && nm !== me.accountName ? nm : "" } : { name: nm };
    await Data.update("people", me.key, { ...Object.fromEntries(pick.map(k => [k, v[k] ?? ""])), ...naming, email: me.email, photo: me.photo });
    Data.setAvatar(v.avatar); UI.toast("Profile updated");
  }

  async function requestTimeOff(preset = {}) {
    const bal = balance(ME());
    const v = await Apps.form("Request time off", [
      { key: "type", label: "Type", type: "select", options: Object.entries(ABS).map(([k, [l]]) => { const b = bal.find(x => x.type === k); return [k, l + (b?.total ? ` · ${fmtN(b.left)} days left` : "")]; }) },
      { key: "from", label: "From", type: "date", half: true, required: true }, { key: "to", label: "To", type: "date", half: true },
      { key: "half", label: "Half day (single day only)", type: "checkbox" },
      { key: "reason", label: "Reason", type: "textarea", rows: 2, placeholder: "Optional" }], { type: "vacation", from: T(), ...preset }, { ok: "Send request" });
    if (!v) return;
    const to = v.to && v.to >= v.from ? v.to : v.from, half = !!v.half && v.from === to, approver = approverFor(ME());
    const rec = { who: ME(), type: v.type, from: v.from, to, half, reason: (v.reason || "").trim(), note: (v.reason || "").trim(), status: "pending", approver };
    const clash = Data.list("absences").find(a => a.who === ME() && stat(a) !== "declined" && a.from <= to && (a.to || a.from) >= v.from);
    if (clash && !(await UI.confirm(`You already have ${ABS[clash.type]?.[0] || "time off"} on ${range(clash.from, clash.to)}. Send this request anyway?`, "Send"))) return;
    const n = workDays(rec);
    await Data.add("absences", rec);
    Data.notify(approver, `🌴 <b>${esc(Data.me().name)}</b> requested time off`, "#/app/company/requests",
      `${ABS[rec.type]?.[0] || "Time off"} · ${range(rec.from, rec.to)}${half ? " (half day)" : ""} · ${plural(n, "working day")}${rec.reason ? " · " + rec.reason : ""}`);
    UI.toast(approver === ME() ? "Request saved. Approve it in Requests." : `🌴 Sent to ${Data.person(approver).name} for approval`);
  }

  // admins add or edit absences directly (they're approved right away)
  async function editAbsence(preset = {}) {
    const v = await Apps.form(preset.id ? "Edit absence" : "Add absence", [{ key: "who", label: "Who", type: "person" }, { key: "type", label: "Type", type: "select", options: Object.entries(ABS).map(([k, [l]]) => [k, l]) },
      { key: "from", label: "From", type: "date", half: true, required: true }, { key: "to", label: "To", type: "date", half: true }, { key: "half", label: "Half day", type: "checkbox" }, { key: "note", label: "Note" }],
      { who: ME(), type: "vacation", from: T(), ...preset }, preset.id ? { onDelete: () => Data.remove("absences", preset.id) } : { ok: "Add" });
    if (!v) return;
    const rec = { who: v.who || ME(), type: v.type, from: v.from, to: v.to && v.to >= v.from ? v.to : v.from, note: v.note || "" };
    rec.half = !!v.half && rec.from === rec.to;
    if (preset.id) return Data.update("absences", preset.id, rec);
    await Data.add("absences", { ...rec, status: "approved", approver: ME(), decidedBy: ME(), decidedAt: Date.now() });
    if (rec.who !== ME()) Data.notify(rec.who, `🌴 <b>${esc(Data.me().name)}</b> added time off for you`, "#/app/company/absence", `${ABS[rec.type]?.[0]} · ${range(rec.from, rec.to)}`);
  }

  async function decideAbsence(a, ok) {
    const v = await Apps.form(ok ? "Approve time off" : "Decline time off", [{ key: "comment", label: ok ? "Comment (optional)" : "Reason (optional)", type: "textarea", rows: 3 }], {}, { ok: ok ? "Approve" : "Decline" });
    if (!v) return;
    const comment = (v.comment || "").trim();
    await Data.update("absences", a.id, { status: ok ? "approved" : "declined", decidedAt: Date.now(), decidedBy: ME(), comment });
    Data.notify(a.who, `${ok ? "✅" : "❌"} <b>${esc(Data.me().name)}</b> ${ok ? "approved" : "declined"} your time off`, "#/app/company/requests",
      `${ABS[a.type]?.[0] || "Time off"} · ${range(a.from, a.to)}${comment ? " · " + comment : ""}`);
    UI.toast(ok ? "✅ Approved" : "Request declined");
  }
  async function cancelRequest(a) {
    if (!(await UI.confirm("Cancel this time off request?", "Cancel request"))) return;
    await Data.remove("absences", a.id); UI.toast("Request cancelled");
  }
  function openAbsence(a, anchor) {
    const me = ME(), p = full(a.who), s = stat(a), admin = isAdmin(), canDecide = s === "pending" && (a.approver === me || admin);
    let pop;
    const act = (label, fn, cls = "btn") => h("button", { class: cls, text: label, onclick: () => { pop.close(); fn(); } });
    const el = h("div", { class: "co-absp" },
      h("div", { class: "co-absp-h" }, Apps.avatar(p, 34), h("div", { class: "grow" }, h("b", { text: p.name }), h("small", { text: ABS[a.type]?.[0] || "Away" })), stTag(s)),
      h("div", { class: "co-absp-r", text: `📅 ${range(a.from, a.to)}${a.half ? " · half day" : ""} · ${plural(workDays(a), "working day")}` }),
      a.reason || a.note ? h("div", { class: "co-absp-r", text: "💬 " + (a.reason || a.note) }) : null,
      a.approver ? h("small", { class: "co-muted", text: (s === "pending" ? "Waiting for " : "Approver: ") + Data.person(a.approver).name }) : null,
      a.comment ? h("small", { class: "co-muted", text: "Reply: " + a.comment }) : null,
      h("div", { class: "co-absp-a" }, canDecide ? act("Decline", () => decideAbsence(a, false)) : null, canDecide ? act("Approve", () => decideAbsence(a, true), "btn primary") : null,
        a.who === me && s === "pending" ? act("Cancel request", () => cancelRequest(a)) : null, admin ? act("Edit", () => editAbsence(a)) : null,
        h("button", { class: "btn", text: "Profile", onclick: () => { pop.close(); openProfile(a.who); } })));
    pop = UI.popover(anchor, el);
  }

  function statusOf(p) {
    const a = outRec(p.key);
    if (a) return { k: "out", text: (ABS[a.type]?.[0] || "Away") + (a.to && a.to !== T() ? " until " + Apps.fmtDate(a.to) : ""), tc: "orange" };
    const s = state(Data.get("timelog", entryId(p.key, T())));
    if (s === "working") return { k: "working", text: "🟢 Working", tc: "green" };
    if (s === "paused") return { k: "working", text: "⏸ On a break", tc: "yellow" };
    if (p.online) return { k: "online", text: "Online", tc: "blue" };
    return null;
  }

  // profile card (slider)
  function openProfile(key) {
    const p = full(key), mine = key === ME(), mgr = managerOf(key), st = statusOf(p), sh = shiftOf(key, T());
    const reports = Data.people().filter(x => x.key !== key && managerOf(x.key) === key);
    const tasks = Apps.liveTasks ? Apps.liveTasks().filter(t => t.status !== "done" && (t.assignee === key || (t.participants || []).includes(key))).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")) : [];
    const row = (ic, label, val) => val ? h("div", { class: "co-pf-row" }, h("span", { class: "co-pf-ic", text: ic }), h("div", null, h("small", { text: label }), typeof val === "string" ? h("span", { text: val }) : val)) : null;
    const plink = (k, label) => h("button", { class: "co-link", onclick: () => openProfile(k) }, label || Data.person(k).name);
    // access levels (js/access.js): level badge, the "Manage" menu and the manager note for people allowed to manage this profile
    const A = Apps.Access, lvl = A?.shared?.() ? A.badge(Apps.role(key)) : null;
    const manage = !mine && A?.manageItems ? A.manageItems(key, { profile: false }) : [];
    const canEditP = !mine && !!Apps.canManage?.(key, "editProfile");
    let pn;
    const body = h("div", { class: "co-pf" },
      h("div", { class: "co-pf-top" }, Apps.avatar(p, 88), h("h2", { text: p.name + (mine ? " (you)" : "") }), h("div", { class: "co-muted", text: p.title || "No title yet" }),
        h("div", { class: "co-pf-tags" }, lvl, st ? h("span", { class: "tag", dataset: { tc: st.tc }, text: st.text }) : h("span", { class: "tag", dataset: { tc: "gray" }, text: "Not in yet" }))),
      h("div", { class: "co-pf-acts" },
        mine ? h("button", { class: "btn primary", text: "Edit profile", onclick: () => { pn.close(); editProfile(); } })
          : h("button", { class: "btn primary", text: "💬 Message", onclick: () => { pn.close(); Apps.go("chat", dmId(key)); } }),
        Apps.Tasks?.newTask ? h("button", { class: "btn", text: "✅ Assign task", onclick: () => { pn.close(); Apps.Tasks.newTask({ assignee: key }); } }) : null,
        p.email ? h("a", { class: "btn", href: "mailto:" + p.email, text: "✉️ Email" }) : null,
        manage.length ? h("button", { class: "btn", text: "⚙️ Manage", onclick: e => UI.menu(e.currentTarget, manage.map(it => it.onClick ? { ...it, onClick: () => { pn.close(); it.onClick(); } } : it), { align: "end" }) }) : null),
      h("div", { class: "co-pf-rows" },
        row("🏢", "Department", p.dept || "Not set"), row("👤", "Manager", mgr ? plink(mgr) : null),
        row("✉️", "Email", p.email ? h("a", { href: "mailto:" + p.email, text: p.email }) : null), row("📞", "Phone", p.phone ? h("a", { href: "tel:" + p.phone, text: p.phone }) : null),
        row("🎂", "Birthday", p.birthday && p.birthday.length >= 10 ? mdLong(p.birthday.slice(5)) : null), row("🎉", "Joined", p.joined ? new Date(p.joined + "T00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null),
        row("🕘", "Today's shift", sh ? span2(sh.start, sh.finish) : null)),
      p.about ? h("p", { class: "co-pf-about", text: p.about }) : null,
      canEditP && p.mgrNote ? h("div", { class: "co-pf-note" }, h("small", { text: "🔒 Manager note" }), h("p", { text: p.mgrNote })) : null,
      reports.length ? h("div", { class: "co-pf-sec" }, h("h4", { text: `Team · ${reports.length}` }), h("div", { class: "co-pf-team" }, ...reports.map(r => h("button", { class: "co-mem", onclick: () => openProfile(r.key) }, Apps.avatar(r, 24), h("span", { text: r.name }))))) : null,
      h("div", { class: "co-pf-sec" }, h("h4", { text: `Open tasks · ${tasks.length}` }),
        ...(tasks.length ? tasks.slice(0, 6).map(t => h("button", { class: "co-pf-task", onclick: () => { pn.close(); openTask(t.id); } }, h("span", { text: t.title || "Untitled task" }), t.deadline ? h("small", { class: "dl" + (t.deadline < T() ? " overdue" : ""), text: Apps.fmtDate(t.deadline) }) : null))
          : [h("small", { class: "co-muted", text: "Nothing open right now." })]),
        tasks.length > 6 ? h("button", { class: "co-link", text: "All tasks →", onclick: () => { pn.close(); Apps.go("tasks"); } }) : null));
    pn = Apps.panel(p.name, body);
    pn.el.classList.add("co-slider");
  }

  function sendWishes(p, kind, yrs) {
    const name = String(p.name || "").split(" ")[0];
    const text = kind === "birthday" ? `Happy birthday, ${name}! 🎂 Wishing you a wonderful year ahead.` : `Happy ${yrs}-year work anniversary, ${name}! 🎉 Thanks for everything you do.`;
    Apps.go("chat", dmId(p.key));
    let tries = 0;
    const fill = () => {
      const i = document.querySelector(".app-chat .chat-input");
      if (!i) return tries++ < 20 && setTimeout(fill, 150);
      if (!i.value) { i.value = text; i.dispatchEvent(new Event("input", { bubbles: true })); }
      i.focus();
    };
    setTimeout(fill, 200);
  }

  /* ---------- departments editing (admins) ---------- */
  function editDepts(fn) {
    const list = departments().map(({ id, name, parent, head }) => ({ id, name, parent: parent || null, head: head || null }));
    fn(list);
    return saveOrg({ departments: list });
  }
  const setDept = (key, name) => Data.update("people", key, { dept: name || "" });
  const descendants = id => { const all = departments(), out = new Set(); const add = x => all.filter(d => d.parent === x && !out.has(d.id)).forEach(d => { out.add(d.id); add(d.id); }); add(id); return out; };
  async function addDept(parent = null) {
    const v = await Apps.form("New department", [{ key: "name", label: "Name", required: true, placeholder: "e.g. Marketing" },
      { key: "parent", label: "Part of", type: "select", options: [["", "Company (top level)"], ...departments().map(d => [d.id, d.name])] }, { key: "head", label: "Head of department", type: "person" }],
      { parent: parent || "" }, { ok: "Add department" });
    if (!v) return;
    const name = v.name.trim();
    if (departments().some(d => d.name.toLowerCase() === name.toLowerCase())) return UI.toast("That department already exists");
    await editDepts(l => l.push({ id: "d-" + Data.uid(), name, parent: v.parent || null, head: v.head || null }));
    if (v.head && !Data.person(v.head).dept) setDept(v.head, name);
    UI.toast("🏢 Department added");
  }
  async function renameDept(d) {
    const v = await Apps.form("Rename department", [{ key: "name", label: "Name", required: true }], { name: d.name });
    const name = v?.name.trim();
    if (!name || name === d.name) return;
    if (departments().some(x => x.id !== d.id && x.name.toLowerCase() === name.toLowerCase())) return UI.toast("That name is taken");
    await editDepts(l => { const x = l.find(y => y.id === d.id); if (x) x.name = name; });
    Data.people().filter(p => p.dept === d.name).forEach(p => setDept(p.key, name)); // members follow the new name
  }
  function moveDept(id, parent) {
    if (id === parent || (parent && descendants(id).has(parent))) return UI.toast("A department can't go inside itself");
    return editDepts(l => { const x = l.find(y => y.id === id); if (x) x.parent = parent || null; });
  }
  async function moveDeptForm(d) {
    const bad = descendants(d.id); bad.add(d.id);
    const v = await Apps.form("Move department", [{ key: "parent", label: `Put “${d.name}” under`, type: "select", options: [["", "Company (top level)"], ...departments().filter(x => !bad.has(x.id)).map(x => [x.id, x.name])] }], { parent: d.parent || "" }, { ok: "Move" });
    if (v) moveDept(d.id, v.parent || null);
  }
  async function deleteDept(d) {
    const all = departments(), parent = all.find(x => x.id === d.parent), n = Data.people().filter(p => p.dept === d.name).length;
    if (!(await UI.confirm(`Delete “${d.name}”? ${n ? `Its ${plural(n, "member")} move to ${parent ? "“" + parent.name + "”" : "no department"}. ` : ""}Sub-departments move up a level.`, "Delete"))) return;
    await editDepts(l => { l.forEach(x => { if (x.parent === d.id) x.parent = d.parent || null; }); l.splice(l.findIndex(x => x.id === d.id), 1); });
    Data.people().filter(p => p.dept === d.name).forEach(p => setDept(p.key, parent ? parent.name : ""));
  }
  function pickHead(anchor, d) {
    Apps.personPicker(anchor, p => {
      editDepts(l => { const x = l.find(y => y.id === d.id); if (x) x.head = p ? p.key : null; });
      if (p && !p.dept) setDept(p.key, d.name);
    }, { allowNone: true });
  }
  function assignPeople(anchor, d) {
    let cur = Data.people().filter(p => p.dept === d.name).map(p => p.key);
    Apps.peoplePicker(anchor, cur, keys => {
      keys.filter(k => !cur.includes(k)).forEach(k => setDept(k, d.name));
      cur.filter(k => !keys.includes(k)).forEach(k => setDept(k, ""));
      cur = keys;
    });
  }
  function deptMenu(anchor, d) {
    UI.menu(anchor, [{ section: d.name },
      { label: "Rename", icon: "text", onClick: () => renameDept(d) }, { label: "Set head", iconHtml: "👤", onClick: () => pickHead(anchor.isConnected ? anchor : null, d) },
      { label: "Add or remove people", iconHtml: "👥", onClick: () => assignPeople(anchor.isConnected ? anchor : null, d) },
      { label: "Add sub-department", icon: "plus", onClick: () => addDept(d.id) }, { label: "Move…", icon: "arrow", onClick: () => moveDeptForm(d) },
      { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: () => deleteDept(d) }], { align: "end" });
  }

  /* ---------- work reports ---------- */
  function writeReport(prev) {
    const me = ME(), cfg = repCfg();
    let period = prev?.period || cfg.period || "week", auto = !prev;
    const picked = new Set(prev?.tasksDone || []);
    const from = input("date", prev?.from), to = input("date", prev?.to);
    const text = h("textarea", { class: "menu-input f-ta co-rep-ta", rows: 6, placeholder: "What did you work on? Results, blockers, plans for next period…" }); text.value = prev?.text || "";
    const box = h("div", { class: "co-rtasks" });
    let shown = [];
    const doneIn = () => {
      const a = new Date(from.value + "T00:00").getTime(), b = new Date((to.value || from.value) + "T23:59:59").getTime();
      return (Apps.liveTasks ? Apps.liveTasks() : Data.list("tasks")).filter(t => t.status === "done" && t.completedAt >= a && t.completedAt <= b && (t.assignee === me || (!t.assignee && t.by === me)))
        .sort((x, y) => (y.completedAt || 0) - (x.completedAt || 0));
    };
    const paint = () => {
      shown = doneIn(); if (auto) shown.forEach(t => picked.add(t.id));
      box.replaceChildren(...(shown.length ? shown.map(t => h("label", { class: "co-rtask" }, h("input", { type: "checkbox", checked: picked.has(t.id), onchange: e => e.target.checked ? picked.add(t.id) : picked.delete(t.id) }),
        h("span", { text: t.title || "Untitled task" }), h("small", { text: new Date(t.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) })))
        : [h("small", { class: "co-muted", text: "No tasks completed in this period." })]));
    };
    const setRange = () => {
      const t = T();
      if (period === "day") { from.value = to.value = t; }
      else if (period === "week") { const m = monday(t); from.value = m; to.value = Apps.addDays(m, 6); }
      else { const d = new Date(); from.value = Apps.iso(new Date(d.getFullYear(), d.getMonth(), 1)); to.value = Apps.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
      paint();
    };
    const seg = h("div", { class: "seg" }, ...[["day", "Day"], ["week", "Week"], ["month", "Month"]].map(([k, l]) => h("button", { type: "button", class: period === k ? "on" : "", text: l,
      onclick: e => { period = k; seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); setRange(); } })));
    from.onchange = to.onchange = paint;
    if (prev) paint(); else setRange();
    const approver = prev?.approver && prev.approver !== me ? prev.approver : approverFor(me);
    dialog(prev ? "Edit report" : "Work report", h("div", { class: "f-grid" },
      field("Period", seg), field("From", from, true), field("To", to, true), field("Report", text),
      field("Tasks completed", box), h("small", { class: "co-muted co-full", text: approver !== me ? `Sent to ${Data.person(approver).name} for review.` : "Nobody to review it yet: set a department head in Structure." })),
      { ok: prev ? "Resend" : "Send report", width: 600, onOk: async () => {
        if (!from.value) { UI.toast("Pick the dates"); return false; }
        const ids = new Set(shown.map(t => t.id)), tasksDone = [...picked].filter(id => ids.has(id));
        if (!text.value.trim() && !tasksDone.length) { UI.toast("Write a few words about your work"); return false; }
        const rec = { who: me, period, from: from.value, to: to.value && to.value >= from.value ? to.value : from.value, text: text.value.trim(), tasksDone, status: "sent", approver, comment: "", score: null };
        if (prev) await Data.update("reports", prev.id, { ...rec, decidedAt: null, sentAt: Date.now() }); else await Data.add("reports", { ...rec, sentAt: Date.now() });
        Data.notify(approver, `📝 <b>${esc(Data.me().name)}</b> sent a work report`, "#/app/company/reports", `${periodLabel(rec)} · ${rec.text.slice(0, 160) || plural(tasksDone.length, "task") + " done"}`);
        UI.toast(approver !== me ? "📝 Report sent" : "📝 Report saved");
      } });
    setTimeout(() => text.focus(), 80);
  }
  function approveReport(r) {
    let score = r.score || 5;
    const starBox = h("div", { class: "co-stars-pick" });
    const paint = () => starBox.replaceChildren(...[1, 2, 3, 4, 5].map(n => h("button", { type: "button", class: n <= score ? "on" : "", text: "★", title: n + " of 5", onclick: () => { score = n; paint(); } })));
    paint();
    const ta = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "Optional" });
    dialog("Approve report", h("div", { class: "f-grid" }, field("Score", starBox), field("Comment", ta)), { ok: "Approve", onOk: async () => {
      const comment = ta.value.trim();
      await Data.update("reports", r.id, { status: "approved", score, comment, decidedAt: Date.now(), decidedBy: ME() });
      Data.notify(r.who, `⭐ <b>${esc(Data.me().name)}</b> approved your work report`, "#/app/company/reports", `${score}/5 · ${periodLabel(r)}${comment ? " · " + comment : ""}`);
      UI.toast("⭐ Report approved");
    } });
  }
  async function returnReport(r) {
    const v = await Apps.form("Return report", [{ key: "comment", label: "What should be changed?", type: "textarea", rows: 3, required: true }], {}, { ok: "Return" });
    if (!v) return;
    await Data.update("reports", r.id, { status: "returned", comment: v.comment.trim(), decidedAt: Date.now(), decidedBy: ME(), score: null });
    Data.notify(r.who, `↩️ <b>${esc(Data.me().name)}</b> returned your work report`, "#/app/company/reports", `${periodLabel(r)} · ${v.comment.trim()}`);
    UI.toast("Report returned");
  }
  async function reportSettings() {
    const c = repCfg();
    const v = await Apps.form("Work report settings", [{ key: "period", label: "Required report", type: "select", options: [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] },
      { key: "remind", label: "Remind people on Friday afternoon (weekly reports)", type: "checkbox" }], c);
    if (v) { await saveOrg({ reports: { period: v.period, remind: !!v.remind } }); UI.toast("Settings saved"); }
  }
  async function leaveSettings() {
    const a = allowance();
    const v = await Apps.form("Leave allowance", [...Object.entries(ABS).map(([k, [l]]) => ({ key: k, label: l + " · days a year", type: "number", half: true })),
      { key: "_hint", label: "Use 0 for types you don't count. They still show on the chart.", type: "hidden" }], a);
    if (v) { await saveOrg({ allowance: Object.fromEntries(Object.keys(ABS).map(k => [k, Math.max(0, +v[k] || 0)])) }); UI.toast("Allowance saved"); }
  }

  /* ---------- shift templates ---------- */
  function editTemplate(t) {
    const name = input("text", t?.name, { placeholder: "e.g. Day shift" }), start = input("time", t?.start || dayStart()), finish = input("time", t?.finish || dayEnd());
    let color = t?.color || PALETTE[1], days = new Set(t?.days || [0, 1, 2, 3, 4, 5, 6].filter(d => !weekendDays().includes(d)));
    const colors = h("div", { class: "accents" }), dayBox = h("div", { class: "co-days" });
    const paint = () => {
      colors.replaceChildren(...PALETTE.map(c => h("button", { type: "button", class: c === color ? "on" : "", style: { background: c, color: c }, onclick: () => { color = c; paint(); } })));
      dayBox.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map(d => h("button", { type: "button", class: "chip-btn" + (days.has(d) ? " on" : ""), text: WD[d], onclick: () => { days.has(d) ? days.delete(d) : days.add(d); paint(); } })));
    };
    paint();
    dialog(t ? "Edit shift template" : "New shift template", h("div", { class: "f-grid" }, field("Name", name), field("Starts", start, true), field("Ends", finish, true), field("Usual days", dayBox), field("Color", colors)),
      { ok: t ? "Save" : "Add template", onDelete: t ? () => Data.remove("shifts", t.id) : null, onOk: async () => {
        if (!name.value.trim() || !start.value || !finish.value) { UI.toast("Name and times are required"); return false; }
        const rec = { kind: "template", name: name.value.trim(), start: start.value, finish: finish.value, color, days: [...days].sort() };
        t ? await Data.update("shifts", t.id, rec) : await Data.add("shifts", rec);
      } });
  }
  async function customShift(who, date, cur) {
    const v = await Apps.form("Shift · " + Data.person(who).name + " · " + dayShort(date), [{ key: "start", label: "Starts", type: "time", half: true, required: true }, { key: "finish", label: "Ends", type: "time", half: true, required: true }, { key: "note", label: "Note" }],
      { start: cur?.start || dayStart(), finish: cur?.finish || dayEnd(), note: cur?.note || "" });
    if (v) setShift(who, date, { start: v.start, finish: v.finish, note: v.note, template: null });
  }
  function cellMenu(anchor, who, date, cur) {
    UI.menu(anchor, [{ section: Data.person(who).name.split(" ")[0] + " · " + dayShort(date) },
      ...templates().map(t => ({ label: `${t.name} · ${span2(t.start, t.finish)}`, iconHtml: `<i class="co-dot" style="background:${esc(t.color || PALETTE[0])}"></i>`, onClick: () => setShift(who, date, { start: t.start, finish: t.finish, template: t.id }) })),
      { label: "Custom time…", iconHtml: "🕘", onClick: () => customShift(who, date, cur) },
      cur ? { sep: true } : null, cur ? { label: "Remove shift", icon: "trash", danger: true, onClick: () => Data.remove("shifts", cur.id) } : null]);
  }

  /* ---------- meetings ---------- */
  function eventFor(m, id) {
    const att = Object.fromEntries((m.attendees || []).filter(k => k !== m.chair).map(k => [k, "pending"]));
    if (m.chair) att[m.chair] = "yes";
    return { title: m.title, date: m.date, allDay: !m.start, start: m.start || "", finish: m.finish || "", where: m.where || "", desc: (m.agenda || []).map(a => "• " + a.text).join("\n"),
      color: "#8b5cf6", owner: m.chair || ME(), attendees: att, calendar: "company", repeat: null, remind: 15, video: m.video || "", files: [], meeting: id };
  }
  async function editMeeting(m) {
    const v = await Apps.form(m ? "Edit meeting" : "New meeting", [
      { key: "title", label: "Title", required: true, placeholder: "e.g. Weekly briefing" },
      { key: "date", label: "Date", type: "date", half: true, required: true }, { key: "where", label: "Place", half: true, placeholder: "Room or address" },
      { key: "start", label: "Starts", type: "time", half: true }, { key: "finish", label: "Ends", type: "time", half: true },
      { key: "chair", label: "Chair", type: "person", half: true }, { key: "attendees", label: "Attendees", type: "people", half: true, placeholder: "Invite people…" },
      ...(m ? [] : [{ key: "agenda", label: "Agenda (one item per line)", type: "textarea", rows: 4 }]),
      !window.Prefs || Prefs.tool("chat", "calls") ? { key: "video", label: "Add a video call link", type: "checkbox" } : null, // Settings → Tools → Chat → calls
      ...(m?.event && Data.get("events", m.event) ? [] : [{ key: "cal", label: "Add to calendar", type: "checkbox" }])].filter(Boolean),
      m ? { ...m, video: !!m.video, cal: false } : { date: T(), start: "10:00", finish: "11:00", chair: ME(), attendees: [], video: false, cal: true }, { ok: m ? "Save" : "Create meeting", width: 580 });
    if (!v) return;
    const rec = { title: v.title.trim(), date: v.date, start: v.start || "", finish: v.finish || "", where: (v.where || "").trim(), chair: v.chair || ME(), attendees: v.attendees || [], video: v.video ? (m?.video || jitsi()) : "" };
    let id = m?.id;
    const before = m ? meetPeople(m) : [];
    if (m) await Data.update("meetings", id, rec);
    else id = await Data.add("meetings", { ...rec, agenda: String(v.agenda || "").split("\n").map(s => s.trim()).filter(Boolean).map(text => ({ id: Data.uid(), text, done: false })), minutes: "", decisions: [], status: "planned" });
    const cur = Data.get("meetings", id) || rec;
    const ev = cur.event && Data.get("events", cur.event);
    if (ev) {
      const att = Object.fromEntries((rec.attendees || []).filter(k => k !== rec.chair).map(k => [k, (ev.attendees || {})[k] || "pending"])); att[rec.chair] = (ev.attendees || {})[rec.chair] || "yes";
      Data.update("events", ev.id, { title: rec.title, date: rec.date, allDay: !rec.start, start: rec.start, finish: rec.finish, where: rec.where, video: rec.video, owner: rec.chair, attendees: att });
    } else if (v.cal) {
      const evId = await Data.add("events", eventFor(cur, id));
      Data.update("meetings", id, { event: evId });
    }
    const fresh = meetPeople(rec).filter(k => !before.includes(k));
    fresh.forEach(k => Data.notify(k, `📋 <b>${esc(Data.me().name)}</b> invited you to a meeting: ${esc(rec.title)}`, "#/app/company/meeting:" + id,
      `${Apps.fmtDate(rec.date)} · ${timeRange(rec)}${rec.where ? " · " + rec.where : ""}${rec.video ? " · video call" : ""}`));
    UI.toast(m ? "Meeting saved" : "📋 Meeting created" + (fresh.filter(k => k !== ME()).length ? ", attendees notified" : ""));
    return id;
  }
  async function deleteMeeting(m, after) {
    const ev = m.event && Data.get("events", m.event);
    if (!(await UI.confirm(`Delete “${m.title || "this meeting"}”${ev ? " and its calendar event" : ""}?`, "Delete"))) return;
    await Data.remove("meetings", m.id); if (ev) Data.remove("events", ev.id);
    UI.toast("Meeting deleted"); after?.();
  }
  function setMeetingStatus(m, s) {
    if ((m.status || "planned") === s) return;
    Data.update("meetings", m.id, { status: s });
    if (s === "cancelled") meetPeople(m).forEach(k => Data.notify(k, `🚫 <b>${esc(m.title)}</b> was cancelled`, "#/app/company/meeting:" + m.id, `${Apps.fmtDate(m.date)} · ${timeRange(m)}`));
  }
  function sendSummary(m) {
    const to = meetPeople(m).filter(k => k !== ME());
    if (!to.length) return UI.toast("Add attendees first");
    const dec = (m.decisions || []).map(d => "• " + d.text + (d.task ? " (task)" : "")).join("\n");
    const body = [String(m.minutes || "").trim(), dec ? "Decisions:\n" + dec : ""].filter(Boolean).join("\n\n") || "No minutes were written.";
    to.forEach(k => Data.notify(k, `📋 Summary of <b>${esc(m.title)}</b>`, "#/app/company/meeting:" + m.id, body));
    Data.update("meetings", m.id, { summaryAt: Date.now() });
    UI.toast(`📨 Summary sent to ${plural(to.length, "person", "people")}`);
  }
  const editList = (id, field, fn) => { const cur = Data.get("meetings", id)?.[field] || []; return Data.update("meetings", id, { [field]: fn(cur) }); };
  const sameItem = (it, i) => (x, j) => it.id ? x.id === it.id : j === i;
  async function decisionTask(m, d, i) {
    const v = await Apps.form("Create a task", [{ key: "title", label: "Task", required: true }, { key: "assignee", label: "Responsible person", type: "person", half: true }, { key: "deadline", label: "Deadline", type: "date", half: true }],
      { title: d.text, assignee: m.chair || ME(), deadline: Apps.addDays(T(), 7) }, { ok: "Create task" });
    if (!v) return;
    const assignee = v.assignee || ME();
    const tid = await Data.add("tasks", { title: v.title.trim(), desc: `From the meeting “${m.title}” on ${Apps.fmtDate(m.date)}`, status: "todo", priority: "normal", assignee, deadline: v.deadline || "",
      checklist: [], comments: [], participants: [], observers: [] });
    await editList(m.id, "decisions", list => list.map((x, j) => sameItem(d, i)(x, j) ? { ...x, task: tid } : x));
    Data.notify(assignee, `✅ <b>${esc(Data.me().name)}</b> gave you a task from a meeting`, "#/app/tasks/" + tid, v.title.trim());
    UI.toast("✅ Task created");
  }

  /* ======================================================================
     The app
     ====================================================================== */
  const TABS = [["people", "Employees"], ["structure", "Structure"], ["requests", "Requests"], ["absence", "Absence chart"], ["worktime", "Worktime"], ["schedules", "Schedules"], ["reports", "Reports"], ["meetings", "Meetings"]];
  const TAB_KEY = "lumen-company-tab";

  function render(root, arg) {
    const m0 = new Date(); m0.setDate(1);
    const S = { q: "", dept: "", filter: "", view: ls("lumen-co-view") || "grid", open: new Set(), zoom: +ls("lumen-co-zoom") || 1, centered: false,
      month: new Date(m0), wtMonth: new Date(m0), wtDept: "", week: monday(T()), rosDept: "", absDept: "", repView: "mine", meetView: "upcoming", meeting: null, flush: null };
    let tab = arg || ls(TAB_KEY) || "people";
    if (tab === "time") tab = "worktime";
    if (tab.startsWith("meeting:")) { S.meeting = tab.slice(8); tab = "meetings"; }
    if (!TABS.some(([k]) => k === tab)) tab = "people";

    const body = h("div", { class: "app-body co-body" }), tabsBox = h("div", { class: "co-tabs" });
    root.classList.add("co-app");
    const reqBtn = h("button", { class: "btn primary", text: "🌴 Request time off", onclick: () => requestTimeOff() });
    root.append(Apps.header("Company", "🏢", "Your team, structure, time off and working hours",
      h("button", { class: "btn", text: "Edit my profile", onclick: editProfile }), reqBtn), tabsBox, body);

    const toApprove = () => { const me = ME(), admin = isAdmin(); return Data.list("absences").filter(a => a.status === "pending" && (a.approver === me || admin)); };
    const toReview = () => { const me = ME(), admin = isAdmin(); return Data.list("reports").filter(r => r.status === "sent" && r.who !== me && (r.approver === me || admin)); };
    function paintTabs() {
      const nReq = toApprove().length, nRep = toReview().length;
      reqBtn.hidden = !toolOn("absence");
      tabsBox.replaceChildren(Apps.tabs(TABS.filter(([k]) => tabOn(k) || k === tab).map(([k, l]) => [k, k === "requests" && nReq ? `${l} · ${nReq}` : k === "reports" && nRep ? `${l} · ${nRep}` : l]), tab, k => setTab(k)));
    }
    function setTab(k, sub) {
      S.flush?.(); S.flush = null;
      tab = k; S.meeting = sub || null; S.centered = false;
      ls(TAB_KEY, k);
      try { history.replaceState(null, "", "#/app/company/" + (sub ? "meeting:" + sub : k)); } catch {}
      draw(true);
    }
    const select = (value, opts, onchange) => h("select", { class: "app-select", onchange: e => onchange(e.target.value) }, ...opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(value) }, l)));
    const deptOpts = () => [["", "All departments"], ...departments().map(d => [d.name, d.name]).sort((a, b) => a[1].localeCompare(b[1])), ["__none", "No department"]];
    const inDept = (p, d) => !d || (d === "__none" ? !p.dept : p.dept === d);
    const nav = (label, onPrev, onNext, onToday) => h("div", { class: "co-nav" }, h("button", { class: "icon-btn", text: "‹", title: "Previous", onclick: onPrev }), h("b", { text: label }), h("button", { class: "icon-btn", text: "›", title: "Next", onclick: onNext }),
      onToday ? h("button", { class: "chip-btn", text: "Today", onclick: onToday }) : null);
    // an input that adds an item on Enter and keeps focus for the next one
    const addInput = (ph, key, onAdd) => {
      const i = h("input", { class: "co-add", placeholder: ph, dataset: { add: key } });
      i.onkeydown = e => { if (e.key !== "Enter" || !i.value.trim()) return; const v = i.value.trim(); i.value = ""; onAdd(v); draw(); body.querySelector(`[data-add="${key}"]`)?.focus(); };
      return i;
    };

    /* ---------- Employees ---------- */
    function upcoming() {
      const t = T(), items = [], tY = +t.slice(0, 4);
      const next = md => { const [mm, dd] = md.split("-").map(Number); let x = new Date(tY, mm - 1, dd); if (Apps.iso(x) < t) x = new Date(tY + 1, mm - 1, dd); return { date: Apps.iso(x), days: Math.round((x - new Date(t + "T00:00")) / 864e5) }; };
      ppl().forEach(p => {
        if (/^\d{4}-\d{2}-\d{2}/.test(p.birthday || "")) { const n = next(p.birthday.slice(5, 10)); if (n.days <= 30) items.push({ p, kind: "birthday", ...n }); }
        if (/^\d{4}-\d{2}-\d{2}/.test(p.joined || "")) { const n = next(p.joined.slice(5, 10)), yrs = +n.date.slice(0, 4) - +p.joined.slice(0, 4); if (n.days <= 30 && yrs >= 1) items.push({ p, kind: "anniv", yrs, ...n }); }
      });
      if (!items.length) return null;
      items.sort((a, b) => a.days - b.days);
      return h("section", { class: "co-up glass" }, h("div", { class: "co-up-h" }, h("span", { text: "🎉" }), h("b", { text: "Upcoming" }), h("small", { text: "Birthdays and work anniversaries in the next 30 days" })),
        h("div", { class: "co-up-list" }, ...items.map((x, i) => h("div", { class: "co-up-i" + (x.days === 0 ? " today" : ""), style: { animationDelay: i * 40 + "ms" } },
          h("button", { class: "co-up-av", onclick: () => openProfile(x.p.key) }, Apps.avatar(x.p, 40), h("span", { class: "co-up-badge", text: x.kind === "birthday" ? "🎂" : "🎉" })),
          h("div", { class: "co-up-t" }, h("b", { text: x.p.name + (x.p.key === ME() ? " (you)" : "") }),
            h("small", { text: (x.kind === "birthday" ? "Birthday" : `${x.yrs} year${x.yrs > 1 ? "s" : ""} with us`) + " · " + (x.days === 0 ? "today" : x.days === 1 ? "tomorrow" : Apps.fmtDate(x.date)) })),
          x.p.key !== ME() ? h("button", { class: "chip-btn", text: "Send wishes", onclick: () => sendWishes(x.p, x.kind, x.yrs) }) : null))));
    }
    function peopleTab() {
      const all = ppl(), stats = new Map(all.map(p => [p.key, statusOf(p)]));
      const nOut = all.filter(p => stats.get(p.key)?.k === "out").length, nWork = all.filter(p => stats.get(p.key)?.k === "working").length;
      const results = h("div", { class: "co-results" });
      const q = h("input", { class: "app-search", type: "search", placeholder: "Search by name, title, email…" }); q.value = S.q;
      q.oninput = () => { S.q = q.value; fill(); };
      const chip = (k, label, n) => h("button", { class: "chip-btn co-chip" + (S.filter === k ? " on" : ""), onclick: () => { S.filter = S.filter === k ? "" : k; draw(); } }, label, h("b", { text: n }));
      const view = h("div", { class: "seg" }, ...[["grid", "▦ Grid"], ["list", "☰ List"]].map(([k, l]) => h("button", { class: S.view === k ? "on" : "", text: l, onclick: () => { S.view = k; ls("lumen-co-view", k); draw(); } })));
      function fill() {
        const s = S.q.trim().toLowerCase();
        const list = all.filter(p => inDept(p, S.dept) && (!S.filter || stats.get(p.key)?.k === S.filter) && (!s || [p.name, p.title, p.dept, p.email, p.phone].join(" ").toLowerCase().includes(s)));
        if (!list.length) return results.replaceChildren(Apps.empty("🔎", all.length ? "Nobody matches these filters." : "No teammates yet."));
        const tagOf = p => { const st = stats.get(p.key); return st ? h("span", { class: "tag", dataset: { tc: st.tc }, text: st.text }) : null; };
        const msg = p => p.key !== ME() ? h("button", { class: "btn", text: "💬 Message", onclick: e => { e.stopPropagation(); Apps.go("chat", dmId(p.key)); } }) : h("button", { class: "btn", text: "Edit profile", onclick: e => { e.stopPropagation(); editProfile(); } });
        if (S.view === "list") return results.replaceChildren(h("div", { class: "co-list glass" },
          h("div", { class: "co-lrow co-lhead" }, h("span", { text: "Name" }), h("span", { text: "Department" }), h("span", { text: "Status" }), h("span", { text: "Contacts" }), h("span")),
          ...list.map((p, i) => h("div", { class: "co-lrow", style: { animationDelay: Math.min(i, 20) * 25 + "ms" }, onclick: () => openProfile(p.key) },
            h("span", { class: "co-lname" }, Apps.avatar(p, 34), h("span", null, h("b", { text: p.name + (p.key === ME() ? " (you)" : "") }), h("small", { text: p.title || "No title yet" }))),
            h("span", { class: "co-ldept", text: p.dept || "—" }), h("span", null, tagOf(p)),
            h("span", { class: "co-lcont" }, p.email ? h("a", { href: "mailto:" + p.email, text: p.email, onclick: e => e.stopPropagation() }) : null, p.phone ? h("a", { href: "tel:" + p.phone, text: p.phone, onclick: e => e.stopPropagation() }) : null),
            h("span", { class: "co-lact" }, msg(p))))));
        results.replaceChildren(h("div", { class: "emp-grid co-grid" }, ...list.map((p, i) => h("div", { class: "emp glass co-emp", style: { animationDelay: Math.min(i, 20) * 40 + "ms" }, onclick: () => openProfile(p.key) },
          Apps.avatar(p, 64), h("b", { text: p.name + (p.key === ME() ? " (you)" : "") }), h("div", { class: "app-sub", text: [p.title, p.dept].filter(Boolean).join(" · ") || "No title yet" }),
          h("div", { class: "emp-st" }, tagOf(p)),
          p.email ? h("a", { class: "emp-l", href: "mailto:" + p.email, text: "✉️ " + p.email, onclick: e => e.stopPropagation() }) : null, p.phone ? h("a", { class: "emp-l", href: "tel:" + p.phone, text: "📞 " + p.phone, onclick: e => e.stopPropagation() }) : null,
          p.about ? h("p", { class: "emp-about", text: p.about }) : null, msg(p)))));
      }
      fill();
      return h("div", null, upcoming(),
        h("div", { class: "app-toolbar co-tools" }, q, select(S.dept, deptOpts(), v => { S.dept = v; fill(); }), chip("out", "🌴 Out today", nOut), chip("working", "🟢 Working now", nWork),
          h("span", { class: "grow" }), view, h("button", { class: "btn", text: "👋 Invite", onclick: e => window.Cloud?.share ? Cloud.share(e.currentTarget) : UI.toast("Invites work in shared workspaces") })),
        results);
    }

    /* ---------- Structure (org chart) ---------- */
    function structureTab() {
      const all = departments(), people = ppl(), admin = isAdmin();
      const members = name => people.filter(p => p.dept === name);
      const seen = new Set();
      const dropOn = (el, d) => {
        if (!admin) return;
        el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drop"); });
        el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
        el.addEventListener("drop", e => {
          e.preventDefault(); e.stopPropagation(); el.classList.remove("drop");
          const v = e.dataTransfer.getData("text/plain") || "";
          if (v.startsWith("co-p:")) { const k = v.slice(5); if (Data.person(k).dept !== (d ? d.name : "")) { setDept(k, d ? d.name : ""); UI.toast(`${first(k)} → ${d ? d.name : "no department"}`); } }
          else if (v.startsWith("co-d:") && v.slice(5) !== d?.id) moveDept(v.slice(5), d ? d.id : null);
        });
      };
      const memberChip = (p, d) => h("div", { class: "co-mem", draggable: admin, title: p.name, onclick: e => { e.stopPropagation(); openProfile(p.key); },
        ondragstart: e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", "co-p:" + p.key); e.dataTransfer.effectAllowed = "move"; } },
        Apps.avatar(p, 24), h("span", { class: "co-mem-t" }, h("span", { text: p.name }), h("small", { text: d?.head === p.key ? "Head" : p.title || "" })), isOut(p.key) ? h("i", { title: "Out today", text: "🌴" }) : null);
      function node(d) {
        if (seen.has(d.id)) return null; seen.add(d.id);
        const mem = members(d.name), head = d.head ? full(d.head) : null, exp = S.open.has(d.id);
        const box = h("div", { class: "co-node glass" + (exp ? " open" : ""), draggable: admin, dataset: { id: d.id } },
          h("div", { class: "co-node-h" }, h("b", { class: "co-node-n", text: d.name }),
            admin ? h("button", { class: "icon-btn xs co-node-more", title: "Department options", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); deptMenu(e.currentTarget, d); } }) : null),
          head ? h("button", { class: "co-node-head", onclick: () => openProfile(head.key) }, Apps.avatar(head, 36), h("span", { class: "co-nh" }, h("span", { class: "co-nh-n", text: head.name }), h("small", { text: head.title || "Head of department" })))
            : h("div", { class: "co-node-head empty" }, h("span", { class: "co-nh-ph", text: "?" }), h("small", { text: "No head yet" }), admin ? h("button", { class: "co-link", text: "Set", onclick: e => { e.stopPropagation(); pickHead(e.currentTarget, d); } }) : null),
          h("button", { class: "co-node-f", title: exp ? "Hide people" : "Show people", onclick: () => { exp ? S.open.delete(d.id) : S.open.add(d.id); draw(); } },
            mem.length ? Apps.avatars(mem.map(p => p.key), 20, 4) : null, h("span", { text: plural(mem.length, "person", "people") }), h("i", { class: "co-caret", text: "▾" })),
          exp ? h("div", { class: "co-node-m" }, ...(mem.length ? mem.map(p => memberChip(p, d)) : [h("small", { class: "co-muted", text: "Nobody here yet" })]),
            admin ? h("button", { class: "co-link", text: "+ Add people", onclick: e => assignPeople(e.currentTarget, d) }) : null) : null);
        if (admin) {
          box.addEventListener("dragstart", e => { if (e.target !== box) return; e.dataTransfer.setData("text/plain", "co-d:" + d.id); e.dataTransfer.effectAllowed = "move"; box.classList.add("dragging"); });
          box.addEventListener("dragend", () => box.classList.remove("dragging"));
          dropOn(box, d);
        }
        const kids = all.filter(x => x.parent === d.id && x.id !== d.id).sort((a, b) => a.name.localeCompare(b.name)).map(node).filter(Boolean);
        return h("li", null, box, kids.length ? h("ul", null, ...kids) : null);
      }
      const roots = all.filter(d => !d.parent || !all.some(x => x.id === d.parent)).sort((a, b) => a.name.localeCompare(b.name));
      const rootBox = h("div", { class: "co-node co-root glass-strong" }, h("span", { class: "app-ic", text: window.Store?.getIcon?.() || "🏢" }),
        h("div", null, h("b", { text: window.Store?.getName?.() || "Company" }), h("small", { text: `${plural(people.length, "person", "people")} · ${plural(all.length, "department")}` })),
        admin ? h("button", { class: "icon-btn xs", title: "Add department", html: UI.icon("plus"), onclick: () => addDept(null) }) : null);
      dropOn(rootBox, null);
      const branches = roots.map(node).filter(Boolean);
      // anything left over sits in a cycle: show it at the top level
      all.filter(d => !seen.has(d.id)).forEach(d => { const n = node(d); if (n) branches.push(n); });
      const tree = h("div", { class: "co-tree", style: { zoom: S.zoom } }, h("ul", null, h("li", null, rootBox, branches.length ? h("ul", null, ...branches) : null)));
      const wrap = h("div", { class: "co-orgwrap glass", dataset: { keep: "org" } }, tree);
      const zl = h("span", { class: "co-zoom-l", text: Math.round(S.zoom * 100) + "%" });
      const setZoom = z => { S.zoom = Math.min(1.6, Math.max(.4, Math.round(z * 10) / 10)); tree.style.zoom = S.zoom; zl.textContent = Math.round(S.zoom * 100) + "%"; ls("lumen-co-zoom", S.zoom); };
      wrap.addEventListener("wheel", e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(S.zoom + (e.deltaY < 0 ? .1 : -.1)); }, { passive: false });
      const allOpen = all.length && all.every(d => S.open.has(d.id));
      const unassigned = people.filter(p => !p.dept);
      if (!S.centered) requestAnimationFrame(() => { if (wrap.isConnected) { wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2; S.centered = true; } });
      return h("div", { class: "co-struct" },
        h("div", { class: "app-toolbar" },
          h("div", { class: "co-zoom" }, h("button", { class: "icon-btn", text: "−", title: "Zoom out", onclick: () => setZoom(S.zoom - .1) }), zl, h("button", { class: "icon-btn", text: "+", title: "Zoom in", onclick: () => setZoom(S.zoom + .1) }),
            h("button", { class: "chip-btn", text: "Reset", onclick: () => setZoom(1) })),
          all.length ? h("button", { class: "chip-btn", text: allOpen ? "Collapse all" : "Show all people", onclick: () => { allOpen ? S.open.clear() : all.forEach(d => S.open.add(d.id)); draw(); } }) : null,
          h("span", { class: "grow" }), admin ? h("small", { class: "co-muted co-hide-m", text: "Drag people or departments to reorganise" }) : null,
          admin ? h("button", { class: "btn primary", text: "+ Department", onclick: () => addDept(null) }) : null),
        all.length ? wrap : Apps.empty("🏢", admin ? "No departments yet. Build your company structure." : "No departments yet. An admin can set them up.", admin ? h("button", { class: "btn primary", text: "+ Add a department", onclick: () => addDept(null) }) : null),
        unassigned.length ? (b => { dropOn(b, null); return b; })(h("div", { class: "co-unassigned glass" }, h("div", { class: "co-up-h" }, h("b", { text: `Not in a department · ${unassigned.length}` }), admin ? h("small", { text: "Drag onto a department, or set it in their profile" }) : h("small", { text: "Set your department in “Edit my profile”" })),
          h("div", { class: "co-mems" }, ...unassigned.map(p => memberChip(p, null))))) : null);
    }

    /* ---------- Requests ---------- */
    function requestsTab() {
      const me = ME(), admin = isAdmin(), all = Data.list("absences"), year = String(new Date().getFullYear());
      const pend = toApprove().sort((a, b) => a.from.localeCompare(b.from));
      const mine = all.filter(a => a.who === me).sort((a, b) => b.from.localeCompare(a.from)).slice(0, 40);
      const bal = balance(me, year);
      const card = (a, mode, i) => {
        const p = full(a.who), s = stat(a), n = workDays(a);
        return h("div", { class: "co-req glass st-" + s, style: { animationDelay: i * 40 + "ms" } },
          mode === "approve" ? h("button", { class: "co-req-av", onclick: () => openProfile(a.who) }, Apps.avatar(p, 40)) : h("span", { class: "co-req-ic", style: { "--c": ABS[a.type]?.[1] || "#64748b" }, text: (ABS[a.type]?.[0] || "📅").split(" ")[0] }),
          h("div", { class: "co-req-main" },
            h("b", { text: mode === "approve" ? p.name : (ABS[a.type]?.[0] || "Time off").replace(/^\S+\s/, "") }),
            h("div", { class: "co-req-d", text: (mode === "approve" ? (ABS[a.type]?.[0] || "Time off") + " · " : "") + range(a.from, a.to) + (a.half ? " · half day" : "") + " · " + plural(n, "working day") }),
            a.reason || (mode === "mine" && a.note) ? h("div", { class: "co-req-r", text: "“" + (a.reason || a.note) + "”" }) : null,
            mode === "approve" ? (b => b?.total ? h("small", { class: "co-muted", text: `${fmtN(b.left)} of ${b.total} ${ABS[a.type][0].replace(/^\S+\s/, "").toLowerCase()} days left this year` }) : null)(balance(a.who, year).find(x => x.type === a.type)) : null,
            mode === "approve" && a.approver && a.approver !== me ? h("small", { class: "co-muted", text: "Assigned to " + Data.person(a.approver).name }) : null,
            mode === "mine" && s === "pending" && a.approver ? h("small", { class: "co-muted", text: "Waiting for " + (a.approver === me ? "you" : Data.person(a.approver).name) }) : null,
            a.comment ? h("small", { class: "co-req-c", text: "💬 " + Data.person(a.decidedBy || a.approver).name.split(" ")[0] + ": " + a.comment }) : null),
          h("div", { class: "co-req-a" }, stTag(s),
            mode === "approve" ? h("div", { class: "co-acts" }, h("button", { class: "btn", text: "Decline", onclick: () => decideAbsence(a, false) }), h("button", { class: "btn primary", text: "Approve", onclick: () => decideAbsence(a, true) })) : null,
            mode === "mine" && s === "pending" ? h("button", { class: "btn", text: "Cancel", onclick: () => cancelRequest(a) }) : null));
      };
      const balCards = bal.filter(b => b.total || b.used || b.pending).map((b, i) => {
        const pct = b.total ? Math.min(100, b.used / b.total * 100) : 0, pp = b.total ? Math.min(100 - pct, b.pending / b.total * 100) : 0;
        return h("div", { class: "co-bal glass", style: { "--c": ABS[b.type][1], animationDelay: i * 40 + "ms" } },
          h("div", { class: "co-bal-h" }, h("span", { text: ABS[b.type][0] })),
          b.total ? h("div", { class: "co-bal-n" }, h("b", { text: fmtN(b.left) }), h("small", { text: `of ${b.total} days left` })) : h("div", { class: "co-bal-n" }, h("b", { text: fmtN(b.used) }), h("small", { text: "days this year" })),
          b.total ? h("div", { class: "co-bar" }, h("i", { style: { width: pct + "%" } }), h("i", { class: "p", style: { width: pp + "%" } })) : null,
          h("small", { class: "co-muted", text: `${fmtN(b.used)} used` + (b.pending ? ` · ${fmtN(b.pending)} pending` : "") }));
      });
      const sec = (title, sub, ...kids) => h("section", { class: "co-sec" }, h("div", { class: "co-sec-h" }, h("h3", { text: title }), sub ? h("small", { text: sub }) : null), ...kids);
      const teamTable = admin && Data.people().length > 1 ? sec("Team balances", year, h("div", { class: "co-table glass" },
        h("div", { class: "co-trow co-thead", style: { "--n": Object.keys(ABS).length } }, h("span", { text: "Person" }), ...Object.values(ABS).map(([l]) => h("span", { text: l }))),
        ...ppl().map(p => { const b = balance(p.key, year); return h("div", { class: "co-trow", style: { "--n": b.length } }, h("span", { class: "co-lname" }, Apps.avatar(p, 24), h("b", { text: p.name })),
          ...b.map(x => h("span", { class: "co-tcell", dataset: { l: ABS[x.type][0] } }, x.total ? h("span", null, h("b", { class: x.left < 0 ? "neg" : "", text: fmtN(x.left) }), h("small", { text: " / " + x.total })) : h("span", { text: x.used ? fmtN(x.used) : "—" })))); }))) : null;
      return h("div", { class: "co-reqs" },
        h("div", { class: "app-toolbar" }, h("span", { class: "grow" }), admin ? h("button", { class: "btn", text: "⚙ Leave allowance", onclick: leaveSettings }) : null, h("button", { class: "btn primary", text: "🌴 Request time off", onclick: () => requestTimeOff() })),
        pend.length || admin || isHead() ? sec("To approve", pend.length ? plural(pend.length, "request") : "All caught up",
          ...(pend.length ? pend.map((a, i) => card(a, "approve", i)) : [h("div", { class: "co-note", text: "✨ No requests waiting for you." })])) : null,
        sec("My balance", year, balCards.length ? h("div", { class: "co-bals" }, ...balCards) : h("div", { class: "co-note", text: "No allowance set yet." })),
        sec("My requests", mine.length ? "" : null, ...(mine.length ? mine.map((a, i) => card(a, "mine", i)) : [h("div", { class: "co-note" }, "No time off yet. ", h("button", { class: "co-link", text: "Request some →", onclick: () => requestTimeOff() }))])),
        teamTable);
    }

    /* ---------- Absence chart ---------- */
    function absenceTab() {
      const days = monthDays(S.month), t = T(), admin = isAdmin(), me = ME();
      const abs = Data.list("absences").filter(a => stat(a) !== "declined");
      const list = ppl().filter(p => inDept(p, S.absDept)).sort((a, b) => String(a.dept || "￿").localeCompare(String(b.dept || "￿")) || a.name.localeCompare(b.name));
      const grid = h("div", { class: "abs-grid co-abs", style: { gridTemplateColumns: `180px repeat(${days.length}, minmax(24px, 1fr))` } },
        h("div", { class: "abs-h" }), ...days.map(d => h("div", { class: "abs-h" + (isWork(d) ? "" : " we") + (d === t ? " today" : ""), title: dayShort(d), text: +d.slice(8) })));
      let dept = null;
      list.forEach(p => {
        if (!S.absDept && (p.dept || "") !== dept) { dept = p.dept || ""; grid.append(h("div", { class: "co-abs-g", text: dept || "No department" })); }
        grid.append(h("div", { class: "abs-name co-abs-name", onclick: () => openProfile(p.key) }, Apps.avatar(p, 22), h("span", { text: p.name })));
        const mineAbs = abs.filter(a => a.who === p.key);
        days.forEach(d => {
          const a = mineAbs.filter(x => covers(x, d)).sort((x, y) => (stat(x) === "approved" ? 0 : 1) - (stat(y) === "approved" ? 0 : 1))[0], s = a ? stat(a) : "";
          const cell = h("div", { class: "abs-c" + (isWork(d) ? "" : " we") + (d === t ? " co-today" : "") + (a ? " co-has" : "") + (s === "pending" ? " co-pend" : "") + (a?.half ? " co-half" : ""),
            style: a ? { "--c": ABS[a.type]?.[1] || "#64748b" } : {}, title: a ? `${ABS[a.type]?.[0] || "Away"}${s === "pending" ? " (pending)" : ""}${a.note ? " · " + a.note : ""}` : dayShort(d) });
          cell.onclick = () => a ? openAbsence(a, cell) : admin ? editAbsence({ who: p.key, from: d }) : p.key === me ? requestTimeOff({ from: d }) : openProfile(p.key);
          grid.append(cell);
        });
      });
      const prev = () => { S.month.setMonth(S.month.getMonth() - 1); draw(); }, next = () => { S.month.setMonth(S.month.getMonth() + 1); draw(); };
      return h("div", null,
        h("div", { class: "app-toolbar" }, nav(S.month.toLocaleDateString(undefined, { month: "long", year: "numeric" }), prev, next, () => { S.month = new Date(m0); draw(); }),
          select(S.absDept, deptOpts(), v => { S.absDept = v; draw(); }), h("span", { class: "grow" }),
          admin ? h("button", { class: "btn", text: "+ Add absence", onclick: () => editAbsence() }) : null, h("button", { class: "btn primary", text: "🌴 Request time off", onclick: () => requestTimeOff() })),
        h("div", { class: "co-legend" }, ...Object.values(ABS).map(([l, c]) => h("span", { class: "legend" }, h("i", { style: { background: c } }), l)), h("span", { class: "legend" }, h("i", { class: "co-pend-i" }), "Pending approval")),
        list.length ? h("div", { class: "abs-wrap glass", dataset: { keep: "abs" } }, grid) : Apps.empty("🌴", "Nobody in this department."));
    }

    /* ---------- Worktime ---------- */
    function worktimeTab() {
      const me = ME(), e = Data.get("timelog", entryId(me, T())), s = state(e), sh = shiftOf(me, T()), late = lateBy(e, sh), tpl = sh?.template ? Data.get("shifts", sh.template) : null;
      const btns = s === "off" ? [h("button", { class: "btn primary big", text: "▶ Start workday", onclick: () => clock("start") })]
        : s === "working" ? [h("button", { class: "btn big", text: "⏸ Pause", onclick: () => clock("pause") }), h("button", { class: "btn primary big", text: "⏹ End workday", onclick: () => clock("end") })]
        : s === "paused" ? [h("button", { class: "btn primary big", text: "▶ Resume", onclick: () => clock("resume") })]
        : [h("button", { class: "btn big", text: "↺ Continue workday", onclick: () => clock("reopen") })];
      const out = outRec(me);
      const clockCard = h("div", { class: "clock-card glass co-clock " + s },
        h("div", { class: "app-sub", text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }),
        h("div", { class: "clock-big co-clock-t", text: hm(worked(e)) }),
        h("div", { class: "app-sub", text: s === "off" ? "Not started yet" : s === "working" ? "Started at " + fmtT(e.start) : s === "paused" ? "On a break" : "Finished at " + fmtT(e.end) }),
        h("div", { class: "co-shiftline" + (sh ? "" : " none"), style: sh ? { "--c": tpl?.color || PALETTE[0] } : {} }, sh ? `🕘 Today's shift ${span2(sh.start, sh.finish)}${tpl ? " · " + tpl.name : ""}` : out ? ABS[out.type]?.[0] + " today" : "No shift planned today"),
        late ? h("span", { class: "tag co-late", dataset: { tc: "red" }, text: `Late by ${late} min` }) : null,
        h("div", { class: "clock-btns" }, ...btns));
      // this week: me, plus the people I manage
      const wk = monday(T()), week = Array.from({ length: 7 }, (_, i) => Apps.addDays(wk, i)), logs = new Map(Data.list("timelog").map(l => [l.who + "|" + l.date, l]));
      const people = team();
      const weekCard = h("div", { class: "report glass co-week" }, h("h3", { text: people.length > 1 ? "This week · team" : "This week" }),
        h("div", { class: "co-scroll", dataset: { keep: "wk" } }, h("div", { class: "tw-grid", style: { gridTemplateColumns: `160px repeat(7, minmax(54px, 1fr)) 80px` } }, h("span"),
          ...week.map(d => h("span", { class: "tw-h" + (d === T() ? " today" : ""), text: dayShort(d) })), h("span", { class: "tw-h", text: "Total" }),
          ...people.flatMap(p => { let tot = 0; const cells = week.map(d => { const ms = worked(logs.get(p.key + "|" + d)); tot += ms; return h("span", { class: "tw-c" + (ms ? " has" : ""), text: ms ? hm(ms) : outRec(p.key, d) ? (ABS[outRec(p.key, d).type]?.[0] || "").split(" ")[0] : "—" }); });
            return [h("span", { class: "who" }, Apps.avatar(p, 20), p.name), ...cells, h("b", { class: "tw-c", text: hm(tot) })]; }))));
      const top = h("div", { class: "time-wrap" }, clockCard, weekCard);
      if (!(isAdmin() || isHead())) return h("div", null, top);
      return h("div", null, top, monthReport());
    }
    function monthReport() {
      const days = monthDays(S.wtMonth), t = T(), idx = shiftIndex(), logs = new Map(Data.list("timelog").map(l => [l.who + "|" + l.date, l]));
      const abs = Data.list("absences").filter(a => stat(a) === "approved");
      const people = team().filter(p => inDept(p, S.wtDept));
      const rows = people.map(p => {
        let ms = 0, worked_ = 0, lates = 0, off = 0;
        const cells = days.map(d => {
          const l = logs.get(p.key + "|" + d), w = worked(l), sh = idx.get(p.key + "|" + d), late = lateBy(l, sh), a = abs.find(x => x.who === p.key && covers(x, d));
          if (w) { ms += w; worked_++; } if (late) lates++; if (a && isWork(d)) off += a.half ? .5 : 1;
          return { d, w, late, a, sh };
        });
        return { p, cells, ms, worked: worked_, lates, off };
      });
      const label = S.wtMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const exportCsv = () => download(`worktime-${Apps.iso(S.wtMonth).slice(0, 7)}.csv`, [["Name", "Email", "Department", ...days, "Hours", "Days worked", "Late arrivals", "Days off"],
        ...rows.map(r => [r.p.name, r.p.email || "", r.p.dept || "", ...r.cells.map(c => c.w ? (c.w / 36e5).toFixed(2) : c.a ? (c.a.type || "off") : ""), (r.ms / 36e5).toFixed(2), r.worked, r.lates, r.off])]);
      const grid = h("div", { class: "co-wt", style: { gridTemplateColumns: `170px repeat(${days.length}, minmax(34px, 1fr)) repeat(4, 58px)` } },
        h("div", { class: "co-wt-h co-wt-n" }, "Person"), ...days.map(d => h("div", { class: "co-wt-h" + (isWork(d) ? "" : " we") + (d === t ? " today" : "") }, h("b", { text: +d.slice(8) }), h("small", { text: WD[dow(d)][0] }))),
        ...["Hours", "Days", "Late", "Off"].map(x => h("div", { class: "co-wt-h co-wt-t", text: x })),
        ...rows.flatMap(r => [h("div", { class: "co-wt-n", onclick: () => openProfile(r.p.key) }, Apps.avatar(r.p, 22), h("span", { text: r.p.name })),
          ...r.cells.map(c => h("div", { class: "co-wt-c" + (isWork(c.d) ? "" : " we") + (c.d === t ? " today" : "") + (c.w ? " has" : "") + (c.late ? " late" : "") + (c.a ? " out" : ""),
            style: c.a ? { "--c": ABS[c.a.type]?.[1] || "#64748b" } : {},
            title: [dayShort(c.d), c.w ? hm(c.w) : "", c.sh ? `shift ${span2(c.sh.start, c.sh.finish)}` : "", c.late ? `late by ${c.late} min` : "", c.a ? ABS[c.a.type]?.[0] : ""].filter(Boolean).join(" · "),
            text: c.w ? (c.w / 36e5).toFixed(1) : c.a ? (ABS[c.a.type]?.[0] || "").split(" ")[0] : "" })),
          h("div", { class: "co-wt-t" }, h("b", { text: fmtN(r.ms / 36e5) })), h("div", { class: "co-wt-t", text: r.worked }), h("div", { class: "co-wt-t" + (r.lates ? " bad" : ""), text: r.lates }), h("div", { class: "co-wt-t", text: fmtN(r.off) })]));
      const cards = h("div", { class: "co-wt-cards" }, ...rows.map(r => h("div", { class: "co-wtc glass", onclick: () => openProfile(r.p.key) },
        h("div", { class: "co-lname" }, Apps.avatar(r.p, 32), h("span", null, h("b", { text: r.p.name }), h("small", { text: r.p.dept || "" }))),
        h("div", { class: "co-wtc-s" }, h("div", null, h("b", { text: fmtN(r.ms / 36e5) }), h("small", { text: "hours" })), h("div", null, h("b", { text: r.worked }), h("small", { text: "days" })),
          h("div", { class: r.lates ? "bad" : "" }, h("b", { text: r.lates }), h("small", { text: "late" })), h("div", null, h("b", { text: fmtN(r.off) }), h("small", { text: "off" }))),
        h("div", { class: "co-wtc-strip" }, ...r.cells.map(c => h("i", { class: (c.w ? "has" : "") + (c.late ? " late" : "") + (c.a ? " out" : "") + (isWork(c.d) ? "" : " we"), style: c.w ? { opacity: Math.min(1, .35 + c.w / 36e5 / 10) } : {} }))))));
      return h("section", { class: "report glass co-month" },
        h("div", { class: "co-sec-h" }, h("h3", { text: "Worktime report" }), h("small", { text: "Hours from the clock, late arrivals against shifts, approved absences" })),
        h("div", { class: "app-toolbar" }, nav(label, () => { S.wtMonth.setMonth(S.wtMonth.getMonth() - 1); draw(); }, () => { S.wtMonth.setMonth(S.wtMonth.getMonth() + 1); draw(); }, () => { S.wtMonth = new Date(m0); draw(); }),
          select(S.wtDept, deptOpts(), v => { S.wtDept = v; draw(); }), h("span", { class: "grow" }), h("button", { class: "btn", text: "⬇ Export CSV", onclick: exportCsv })),
        rows.length ? h("div", null, h("div", { class: "co-scroll co-wt-wrap", dataset: { keep: "wt" } }, grid), cards) : Apps.empty("⏱️", "Nobody to show."),
        h("small", { class: "co-muted", text: "Cells show hours worked. Red marks a late start (more than 10 minutes after the shift began)." }));
    }

    /* ---------- Schedules ---------- */
    function schedulesTab() {
      const wk = S.week, dates = Array.from({ length: 7 }, (_, i) => Apps.addDays(wk, i)), tpls = templates(), tplMap = Object.fromEntries(tpls.map(x => [x.id, x])), idx = shiftIndex();
      const canAny = isAdmin() || isHead(), me = ME();
      const abs = Data.list("absences").filter(a => stat(a) === "approved");
      const people = ppl().filter(p => inDept(p, S.rosDept));
      const editable = people.filter(p => canManage(p.key));
      const copyWeek = async () => {
        const prev = Apps.addDays(wk, -7), src = Data.list("shifts").filter(s => s.kind === "shift" && s.date >= prev && s.date < wk && canManage(s.who) && people.some(p => p.key === s.who));
        if (!src.length) return UI.toast("No shifts last week to copy");
        let n = 0; src.forEach(s => { const d = Apps.addDays(s.date, 7); if (!idx.has(s.who + "|" + d)) { setShift(s.who, d, s); n++; } });
        UI.toast(n ? `Copied ${plural(n, "shift")}` : "This week already has those shifts");
      };
      const clearWeek = async () => {
        const list = dates.flatMap(d => editable.map(p => idx.get(p.key + "|" + d)).filter(Boolean));
        if (!list.length) return UI.toast("This week is already empty");
        if (!(await UI.confirm(`Remove ${plural(list.length, "shift")} from this week?`, "Clear week"))) return;
        list.forEach(s => Data.remove("shifts", s.id));
      };
      const applyTpl = (p, t) => { let n = 0; dates.forEach(d => { if ((t.days || []).includes(dow(d)) && !abs.some(a => a.who === p.key && covers(a, d))) { setShift(p.key, d, { start: t.start, finish: t.finish, template: t.id }); n++; } }); UI.toast(n ? `${t.name}: ${plural(n, "shift")} for ${first(p.key)}` : "No matching days this week"); };
      const rowMenu = (anchor, p) => UI.menu(anchor, [{ section: p.name },
        ...tpls.map(t => ({ label: `Fill week with “${t.name}”`, iconHtml: `<i class="co-dot" style="background:${esc(t.color || PALETTE[0])}"></i>`, onClick: () => applyTpl(p, t) })),
        { label: "Clear this week", icon: "trash", onClick: () => dates.forEach(d => { const s = idx.get(p.key + "|" + d); if (s) Data.remove("shifts", s.id); }) },
        { sep: true }, { label: "Open profile", iconHtml: "👤", onClick: () => openProfile(p.key) }]);
      const head = h("div", { class: "co-ros-row co-ros-head" }, h("div", { class: "co-ros-n" }, "Person"), ...dates.map(d => h("div", { class: "co-ros-hd" + (d === T() ? " today" : "") + (isWork(d) ? "" : " we") }, h("small", { text: WD[dow(d)] }), h("b", { text: +d.slice(8) }))));
      const rows = people.map((p, i) => {
        const can = canManage(p.key);
        return h("div", { class: "co-ros-row", style: { animationDelay: Math.min(i, 20) * 25 + "ms" } },
          h("div", { class: "co-ros-n", onclick: e => can ? rowMenu(e.currentTarget, p) : openProfile(p.key) }, Apps.avatar(p, 26), h("span", null, h("b", { text: p.name }), h("small", { text: p.title || p.dept || "" }))),
          ...dates.map(d => {
            const s = idx.get(p.key + "|" + d), a = abs.find(x => x.who === p.key && covers(x, d)), t = s?.template ? tplMap[s.template] : null;
            const cell = h("div", { class: "co-ros-c" + (d === T() ? " today" : "") + (isWork(d) ? "" : " we") + (can ? " can" : "") },
              h("span", { class: "co-dl", text: dayShort(d) }),
              s ? h("span", { class: "co-shift", style: { "--c": t?.color || PALETTE[0] }, title: s.note || "" }, h("b", { text: span2(s.start, s.finish) }), t ? h("small", { text: t.name }) : s.note ? h("small", { text: s.note }) : null) : null,
              a ? h("span", { class: "co-ros-abs", title: ABS[a.type]?.[0] || "Away", style: { "--c": ABS[a.type]?.[1] || "#64748b" }, text: (ABS[a.type]?.[0] || "Away").split(" ")[0] }) : null,
              !s && !a && can ? h("span", { class: "co-ros-add", text: "+" }) : null);
            if (can) cell.onclick = () => cellMenu(cell, p.key, d, s);
            return cell;
          }));
      });
      const upcomingMine = Data.list("shifts").filter(s => s.kind === "shift" && s.who === me && s.date >= T() && s.date <= Apps.addDays(T(), 14)).sort((a, b) => a.date.localeCompare(b.date));
      const label = `${Apps.fmtDate(wk)} – ${Apps.fmtDate(Apps.addDays(wk, 6))}`;
      return h("div", { class: "co-sched" },
        h("div", { class: "app-toolbar" }, nav(label, () => { S.week = Apps.addDays(S.week, -7); draw(); }, () => { S.week = Apps.addDays(S.week, 7); draw(); }, () => { S.week = monday(T()); draw(); }),
          select(S.rosDept, deptOpts(), v => { S.rosDept = v; draw(); }), h("span", { class: "grow" }),
          canAny ? h("button", { class: "btn", text: "⧉ Copy last week", onclick: copyWeek }) : null, canAny ? h("button", { class: "btn", text: "Clear week", onclick: clearWeek }) : null),
        h("div", { class: "co-tpls" }, h("small", { class: "co-muted", text: "Shift templates" }),
          ...tpls.map(t => h("button", { class: "co-tpl", style: { "--c": t.color || PALETTE[0] }, title: (t.days || []).map(d => WD[d]).join(", "), onclick: () => canAny ? editTemplate(t) : null },
            h("i"), h("b", { text: t.name }), h("small", { text: span2(t.start, t.finish) }))),
          canAny ? h("button", { class: "chip-btn", text: "+ Template", onclick: () => editTemplate() }) : null,
          canAny && !tpls.length ? h("button", { class: "chip-btn", text: "✨ Add standard shifts", onclick: () => {
            (wd => [["Day", dayStart(), dayEnd(), PALETTE[1], wd], ["Morning", "07:00", "15:00", PALETTE[4], wd], ["Evening", "15:00", "23:00", PALETTE[0], wd]])([0, 1, 2, 3, 4, 5, 6].filter(d => !weekendDays().includes(d)))
              .forEach(([name, start, finish, color, days]) => Data.add("shifts", { kind: "template", name, start, finish, color, days }));
          } }) : null),
        people.length ? h("div", { class: "co-roster glass", dataset: { keep: "ros" } }, head, ...rows) : Apps.empty("🗓️", "Nobody in this department."),
        canAny ? h("small", { class: "co-muted", text: "Click a cell to assign a shift, or a name to fill the whole week from a template." }) : null,
        h("section", { class: "co-sec" }, h("div", { class: "co-sec-h" }, h("h3", { text: "My upcoming shifts" }), h("small", { text: "Next 14 days" })),
          upcomingMine.length ? h("div", { class: "co-myshifts" }, ...upcomingMine.map((s, i) => { const t = s.template ? tplMap[s.template] : null; return h("div", { class: "co-myshift glass" + (s.date === T() ? " today" : ""), style: { "--c": t?.color || PALETTE[0], animationDelay: i * 40 + "ms" } },
            h("b", { text: s.date === T() ? "Today" : new Date(s.date + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) }), h("span", { text: span2(s.start, s.finish) }), h("small", { text: t?.name || s.note || "Custom" })); }))
            : h("div", { class: "co-note", text: "No shifts planned for you in the next two weeks." })));
    }

    /* ---------- Reports ---------- */
    function reportsTab() {
      const me = ME(), admin = isAdmin(), all = Data.list("reports"), cfg = repCfg();
      const review = toReview().sort((a, b) => (a.sentAt || a.at) - (b.sentAt || b.at));
      const reviewed = all.filter(r => r.status !== "sent" && r.who !== me && (r.decidedBy === me || r.approver === me)).sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0)).slice(0, 20);
      const mine = all.filter(r => r.who === me).sort((a, b) => String(b.from).localeCompare(String(a.from)) || b.at - a.at);
      const canReview = admin || isHead() || review.length || reviewed.length;
      if (!canReview) S.repView = "mine";
      const card = (r, mode, i) => {
        const who = full(r.who), st = r.status || "sent", tasks = (r.tasksDone || []).map(id => Data.get("tasks", id)).filter(Boolean);
        return h("div", { class: "co-rep glass st-" + st, style: { animationDelay: Math.min(i, 12) * 40 + "ms" } },
          h("div", { class: "co-rep-h" }, mode === "review" ? h("button", { class: "co-req-av", onclick: () => openProfile(r.who) }, Apps.avatar(who, 36)) : h("span", { class: "co-rep-ic", text: "📝" }),
            h("div", { class: "grow" }, h("b", { text: mode === "review" ? who.name : periodLabel(r) }), h("small", { text: (mode === "review" ? periodLabel(r) + " · " : "") + range(r.from, r.to) + " · " + UI.timeAgo(r.sentAt || r.at) })),
            r.score && st === "approved" ? stars(r.score) : null, stTag(st)),
          r.text ? h("div", { class: "co-rep-t", text: r.text }) : null,
          tasks.length ? h("div", { class: "co-rep-tasks" }, h("small", { text: `✅ ${plural(tasks.length, "task")} done` }), ...tasks.map(t => h("button", { class: "chip-btn", text: t.title || "Untitled task", onclick: () => openTask(t.id) }))) : null,
          r.comment ? h("div", { class: "co-rep-c" }, Apps.avatar(Data.person(r.decidedBy || r.approver), 22), h("span", { text: r.comment })) : null,
          h("div", { class: "co-rep-a" },
            mode === "mine" && st === "sent" && r.approver ? h("small", { class: "co-muted", text: r.approver === me ? "No reviewer yet" : "Waiting for " + Data.person(r.approver).name }) : null,
            h("span", { class: "grow" }),
            mode === "review" && st === "sent" ? [h("button", { class: "btn", text: "↩ Return", onclick: () => returnReport(r) }), h("button", { class: "btn primary", text: "★ Approve", onclick: () => approveReport(r) })] : null,
            mode === "mine" && st !== "approved" ? h("button", { class: "btn" + (st === "returned" ? " primary" : ""), text: st === "returned" ? "Edit and resend" : "Edit", onclick: () => writeReport(r) }) : null,
            mode === "mine" && st !== "approved" ? h("button", { class: "icon-btn", title: "Delete", html: UI.icon("trash"), onclick: async () => { if (await UI.confirm("Delete this report?")) Data.remove("reports", r.id); } }) : null));
      };
      const wk = monday(T()), due = cfg.period === "week" && !hasReport(me, wk);
      const scored = mine.filter(r => r.status === "approved" && r.score), avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0;
      return h("div", { class: "co-reps" },
        h("div", { class: "app-toolbar" },
          canReview ? h("div", { class: "seg" }, h("button", { class: S.repView === "mine" ? "on" : "", text: "My reports", onclick: () => { S.repView = "mine"; draw(); } }),
            h("button", { class: S.repView === "review" ? "on" : "", text: "To review" + (review.length ? ` · ${review.length}` : ""), onclick: () => { S.repView = "review"; draw(); } })) : null,
          h("span", { class: "grow" }), admin ? h("button", { class: "btn", text: "⚙ Settings", onclick: reportSettings }) : null, h("button", { class: "btn primary", text: "✍️ Write report", onclick: () => writeReport() })),
        S.repView === "review" ? h("div", null,
          review.length ? h("div", { class: "co-list-v" }, ...review.map((r, i) => card(r, "review", i))) : h("div", { class: "co-note", text: "✨ No reports waiting for review." }),
          reviewed.length ? h("section", { class: "co-sec" }, h("div", { class: "co-sec-h" }, h("h3", { text: "Reviewed" })), ...reviewed.map((r, i) => card(r, "review", i))) : null)
        : h("div", null,
          due ? h("div", { class: "co-banner glass" }, h("span", { text: "📝" }), h("div", { class: "grow" }, h("b", { text: "This week's report isn't sent yet" }), h("small", { text: "Share what you got done with " + (managerOf(me) ? Data.person(managerOf(me)).name : "your manager") + "." })),
            h("button", { class: "btn primary", text: "Write it now", onclick: () => writeReport() })) : null,
          scored.length ? h("div", { class: "co-repstat" }, stars(Math.round(avg)), h("small", { text: `Average score ${avg.toFixed(1)} from ${plural(scored.length, "report")}` })) : null,
          mine.length ? h("div", { class: "co-list-v" }, ...mine.map((r, i) => card(r, "mine", i))) : Apps.empty("📝", `No reports yet. ${cfg.period === "day" ? "Daily" : cfg.period === "month" ? "Monthly" : "Weekly"} reports go to your manager.`, h("button", { class: "btn primary", text: "Write your first report", onclick: () => writeReport() }))));
    }

    /* ---------- Meetings ---------- */
    const dateBlock = d => { const x = new Date((d || T()) + "T00:00"); return h("div", { class: "co-dblock" + (d === T() ? " today" : "") }, h("small", { text: x.toLocaleDateString(undefined, { month: "short" }) }), h("b", { text: x.getDate() }), h("small", { text: x.toLocaleDateString(undefined, { weekday: "short" }) })); };
    function meetingsTab() {
      if (S.meeting) return meetingPage(S.meeting);
      const t = T(), all = Data.list("meetings").filter(canSeeMeeting);
      const up = all.filter(m => (m.date || "") >= t).sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
      const past = all.filter(m => (m.date || "") < t).sort((a, b) => (b.date + (b.start || "")).localeCompare(a.date + (a.start || "")));
      const list = S.meetView === "past" ? past : up;
      const card = (m, i) => {
        const ag = m.agenda || [], st = m.status || "planned", dn = ag.filter(x => x.done).length;
        return h("div", { class: "co-mcard glass st-" + st, role: "button", tabindex: 0, style: { animationDelay: Math.min(i, 12) * 40 + "ms" }, onclick: () => setTab("meetings", m.id), onkeydown: e => { if (e.key === "Enter") setTab("meetings", m.id); } },
          dateBlock(m.date),
          h("div", { class: "co-mcard-m" }, h("b", { text: m.title || "Untitled meeting" }),
            h("small", { class: "co-muted", text: [timeRange(m), m.where ? "📍 " + m.where : "", m.video ? "📹 Video call" : ""].filter(Boolean).join(" · ") }),
            h("div", { class: "co-mcard-f" }, Apps.avatars(meetPeople(m), 22, 6), ag.length ? h("small", { text: `☑️ ${dn}/${ag.length}` }) : null, (m.decisions || []).length ? h("small", { text: `💡 ${(m.decisions || []).length}` }) : null)),
          stTag(st));
      };
      return h("div", { class: "co-meets" },
        h("div", { class: "app-toolbar" }, h("div", { class: "seg" }, h("button", { class: S.meetView !== "past" ? "on" : "", text: `Upcoming · ${up.length}`, onclick: () => { S.meetView = "upcoming"; draw(); } }),
          h("button", { class: S.meetView === "past" ? "on" : "", text: `Past · ${past.length}`, onclick: () => { S.meetView = "past"; draw(); } })),
          h("span", { class: "grow" }), h("button", { class: "btn primary", text: "+ New meeting", onclick: async () => { const id = await editMeeting(); if (id) setTab("meetings", id); } })),
        list.length ? h("div", { class: "co-mlist" }, ...list.map(card))
          : Apps.empty("📋", S.meetView === "past" ? "No past meetings yet." : "No upcoming meetings. Plan a briefing with an agenda and minutes.", S.meetView === "past" ? null : h("button", { class: "btn primary", text: "+ New meeting", onclick: async () => { const id = await editMeeting(); if (id) setTab("meetings", id); } })));
    }
    function meetingPage(id) {
      const back = h("button", { class: "btn co-back", text: "‹ Meetings", onclick: () => setTab("meetings") });
      const m = Data.get("meetings", id);
      if (!m) return h("div", { class: "co-meet" }, back, Apps.empty("📋", Data.list("meetings").length ? "This meeting was deleted." : "Loading the meeting…"));
      if (!canSeeMeeting(m)) return h("div", { class: "co-meet" }, back, Apps.empty("🔒", "Only the attendees can see this meeting."));
      const edit = canEditMeeting(m), write = canWriteMeeting(m), st = m.status || "planned", ev = m.event ? Data.get("events", m.event) : null;
      const RS = { yes: ["✓", "Going"], no: ["✗", "Not going"], maybe: ["?", "Maybe"] };
      const person = (k, role) => { const r = RS[ev?.attendees?.[k]]; return h("button", { class: "co-mem", title: r ? r[1] : "", onclick: () => openProfile(k) }, Apps.avatar(Data.person(k), 26),
        h("span", { class: "co-mem-t" }, h("span", { text: Data.person(k).name }), role ? h("small", { text: role }) : null), r ? h("i", { class: "co-rsvp " + ev.attendees[k], text: r[0] }) : null); };
      const more = e => UI.menu(e.currentTarget, [ev ? { label: "Open in calendar", iconHtml: "📅", onClick: () => Apps.go("calendar", ev.id) } : null,
        { label: "Copy link", icon: "link", onClick: () => { navigator.clipboard?.writeText(location.origin + location.pathname + "#/app/company/meeting:" + m.id); UI.toast("Link copied"); } },
        edit ? { sep: true } : null, edit ? { label: "Delete meeting", icon: "trash", danger: true, onClick: () => deleteMeeting(m, () => setTab("meetings")) } : null], { align: "end" });
      const header = h("section", { class: "co-mh glass" },
        h("div", { class: "co-mh-top" }, back, h("span", { class: "grow" }), edit ? h("button", { class: "btn", text: "Edit", onclick: () => editMeeting(m) }) : null,
          write ? h("button", { class: "btn primary", text: "📨 Send summary", onclick: () => sendSummary(m) }) : null, h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: more })),
        h("div", { class: "co-mh-title" }, dateBlock(m.date), h("div", { class: "grow" }, h("h2", { text: m.title || "Untitled meeting" }),
          h("div", { class: "co-mh-meta" }, h("span", { text: "🕘 " + timeRange(m) }), m.where ? h("span", { text: "📍 " + m.where }) : null,
            m.video ? h("a", { class: "chip-btn co-join", href: m.video, target: "_blank", rel: "noopener", text: "📹 Join video call" }) : null,
            ev ? h("button", { class: "chip-btn", text: "📅 In calendar", onclick: () => Apps.go("calendar", ev.id) }) : null,
            m.summaryAt ? h("small", { class: "co-muted", text: "Summary sent " + UI.timeAgo(m.summaryAt) }) : null))),
        h("div", { class: "co-mh-people" }, m.chair ? person(m.chair, "Chair") : null, ...(m.attendees || []).filter(k => k !== m.chair).map(k => person(k))),
        h("div", { class: "co-mh-st" }, edit ? h("div", { class: "seg" }, ...["planned", "held", "cancelled"].map(s => h("button", { class: st === s ? "on" : "", text: STAT[s][0], onclick: () => setMeetingStatus(m, s) }))) : stTag(st)));
      const ag = m.agenda || [];
      const agenda = h("section", { class: "co-card glass" }, h("div", { class: "co-card-h" }, h("h3", { text: "Agenda" }), ag.length ? h("small", { text: `${ag.filter(x => x.done).length} of ${ag.length} done` }) : null),
        ag.length ? h("div", { class: "co-bar sm" }, h("i", { style: { width: (ag.filter(x => x.done).length / ag.length * 100) + "%" } })) : null,
        ...ag.map((it, i) => h("label", { class: "co-ag" + (it.done ? " done" : "") },
          h("input", { type: "checkbox", checked: !!it.done, disabled: !write, onchange: e => editList(m.id, "agenda", l => l.map((x, j) => sameItem(it, i)(x, j) ? { ...x, done: e.target.checked } : x)) }),
          h("span", { class: "grow", text: it.text }),
          edit ? h("button", { class: "icon-btn xs co-x", title: "Remove", text: "×", onclick: e => { e.preventDefault(); editList(m.id, "agenda", l => l.filter((x, j) => !sameItem(it, i)(x, j))); } }) : null)),
        !ag.length && !write ? h("small", { class: "co-muted", text: "No agenda." }) : null,
        write ? addInput("+ Add an agenda item", "agenda", text => editList(m.id, "agenda", l => [...l, { id: Data.uid(), text, done: false }])) : null);
      const decs = m.decisions || [];
      const taskChip = tid => { const tk = Data.get("tasks", tid); return h("button", { class: "chip-btn co-task" + (tk?.status === "done" ? " done" : ""), title: tk?.title || "Task", onclick: () => openTask(tid) },
        (tk?.status === "done" ? "✅ " : "☑️ ") + (tk ? first(tk.assignee || tk.by) + (tk.deadline ? " · " + Apps.fmtDate(tk.deadline) : "") : "Task")); };
      const decisions = h("section", { class: "co-card glass" }, h("div", { class: "co-card-h" }, h("h3", { text: "Decisions" }), decs.length ? h("small", { text: `${decs.filter(d => d.task).length} turned into tasks` }) : null),
        ...decs.map((d, i) => h("div", { class: "co-dec" }, h("span", { class: "co-dec-n", text: i + 1 }), h("span", { class: "grow", text: d.text }),
          d.task ? taskChip(d.task) : write ? h("button", { class: "chip-btn", text: "→ Task", title: "Make this a task", onclick: () => decisionTask(m, d, i) }) : null,
          edit ? h("button", { class: "icon-btn xs co-x", title: "Remove", text: "×", onclick: () => editList(m.id, "decisions", l => l.filter((x, j) => !sameItem(d, i)(x, j))) }) : null)),
        !decs.length && !write ? h("small", { class: "co-muted", text: "No decisions recorded." }) : null,
        write ? addInput("+ Record a decision", "decision", text => editList(m.id, "decisions", l => [...l, { id: Data.uid(), text }])) : null);
      // minutes: saved a moment after you stop typing; liveDraw keeps others' updates from clobbering the box while you type
      const ta = h("textarea", { class: "co-minutes", placeholder: write ? "Write the minutes as the meeting goes…" : "No minutes yet.", readonly: !write }); ta.value = m.minutes || "";
      const saved = h("small", { class: "co-saved", text: m.minutesAt ? "Saved " + UI.timeAgo(m.minutesAt) + (m.minutesBy && m.minutesBy !== ME() ? " by " + first(m.minutesBy) : "") : "" });
      let timer = null, last = m.minutes || "";
      const save = () => { clearTimeout(timer); timer = null; if (!write || ta.value === last) return; last = ta.value; Data.update("meetings", m.id, { minutes: ta.value, minutesAt: Date.now(), minutesBy: ME() }); saved.textContent = "Saved"; };
      ta.oninput = () => { saved.textContent = "Editing…"; clearTimeout(timer); timer = setTimeout(save, 2500); };
      ta.onblur = save; S.flush = save;
      // AI summary (js/ai.js) from agenda + minutes + decisions, added to the minutes
      const aiSum = write && Apps.AI?.available("meetings") ? Apps.AI.button("Summarise meeting", () => Apps.AI.compose({ title: "Meeting summary", task: "summarize_meeting",
        input: [ag.length ? "Agenda:\n" + ag.map(a => "- " + a.text + (a.done ? " (done)" : "")).join("\n") : "", ta.value.trim() ? "Minutes:\n" + ta.value.trim() : "", decs.length ? "Decisions:\n" + decs.map(d => "- " + d.text).join("\n") : ""].filter(Boolean).join("\n\n"),
        context: `${m.title || "Meeting"} · ${m.date || ""}`, emptyHint: "Add an agenda, minutes or decisions first.", insertLabel: "Add to minutes",
        onInsert: v => { save(); const cur = String(Data.get("meetings", m.id)?.minutes || "").trimEnd(), next = (cur ? cur + "\n\n" : "") + v;
          ta.value = last = next; Data.update("meetings", m.id, { minutes: next, minutesAt: Date.now(), minutesBy: ME() }); saved.textContent = "Saved"; } })) : null;
      const minutes = h("section", { class: "co-card glass co-mins" }, h("div", { class: "co-card-h" }, h("h3", { text: "Minutes" }), saved, aiSum), ta);
      return h("div", { class: "co-meet" }, header, h("div", { class: "co-meet-grid" }, h("div", { class: "co-meet-col" }, agenda, decisions), minutes));
    }

    const VIEWS = { people: peopleTab, structure: structureTab, requests: requestsTab, absence: absenceTab, worktime: worktimeTab, schedules: schedulesTab, reports: reportsTab, meetings: meetingsTab };
    function draw(anim) {
      S.flush?.(); S.flush = null;
      const keep = {}; body.querySelectorAll("[data-keep]").forEach(el => { keep[el.dataset.keep] = [el.scrollLeft, el.scrollTop]; });
      paintTabs();
      let view;
      try { view = !tabOn(tab) ? Apps.empty("🔌", (TABS.find(([k]) => k === tab)?.[1] || "This tab") + " is switched off in Settings → Tools.", h("button", { class: "btn", text: "Go to employees", onclick: () => setTab("people") })) : VIEWS[tab](); } catch (e) { console.error(e); view = Apps.empty("⚠️", "Something went wrong: " + e.message); }
      if (anim) view.classList.add("co-enter");
      body.replaceChildren(view);
      body.querySelectorAll("[data-keep]").forEach(el => { const k = keep[el.dataset.keep]; if (k) { el.scrollLeft = k[0]; el.scrollTop = k[1]; } });
    }
    let ready = false, raf = 0;
    const live = UI.liveDraw(body, () => draw());
    const sched = () => { if (!ready) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(live); };
    const offs = ["people", "absences", "timelog", "settings", "reports", "shifts", "meetings"].map(c => Data.on(c, sched));
    offs.push(Data.on("tasks", () => (tab === "reports" || (tab === "meetings" && S.meeting)) && sched()));
    ready = true;
    draw(true);
    if (S.meeting) try { history.replaceState(null, "", "#/app/company/meeting:" + S.meeting); } catch {}
    const tick = setInterval(() => { const el = body.querySelector(".co-clock-t"); if (el) el.textContent = hm(worked(Data.get("timelog", entryId(ME(), T())))); }, 30000);
    return () => { S.flush?.(); offs.forEach(f => f()); clearInterval(tick); cancelAnimationFrame(raf); };
  }

  /* ---------- clock in / out (data shape unchanged: timelog id who_date, {who, date, start, end, pauses:[{s,e}]}) ---------- */
  function clock(action) {
    const me = Data.me().key, d = Apps.today(), id = entryId(me, d), e = Data.get("timelog", id), now = Date.now();
    if (action === "start") Data.add("timelog", { who: me, date: d, start: now, end: null, pauses: [], at: now }, id);
    if (action === "pause") Data.update("timelog", id, { pauses: [...(e.pauses || []), { s: now, e: null }] });
    if (action === "resume") Data.update("timelog", id, { pauses: (e.pauses || []).map(p => p.e ? p : { ...p, e: now }) });
    if (action === "end") Data.update("timelog", id, { end: now, pauses: (e.pauses || []).map(p => p.e ? p : { ...p, e: now }) });
    if (action === "reopen") Data.update("timelog", id, { end: null });
    if (action === "start") { const late = lateBy({ start: now }, shiftOf(me, d)); if (late) UI.toast(`🕘 Clocked in ${late} min after your shift started`); }
  }
  // topbar pill showing today's worked time
  function pill() {
    let el = document.getElementById("workPill");
    if (!el) { const tb = document.querySelector(".tb-right"); if (!tb) return; el = h("button", { class: "work-pill", id: "workPill", onclick: () => Apps.go("company", "worktime") }); tb.prepend(el); }
    const e = Data.get("timelog", entryId(Data.me().key, Apps.today())), s = state(e);
    el.style.display = s === "off" ? "none" : "";
    el.className = "work-pill " + s; el.textContent = (s === "working" ? "🟢 " : s === "paused" ? "⏸ " : "✅ ") + hm(worked(e));
  }
  // sidebar badge: requests and reports waiting for me
  function badge() {
    const me = ME();
    const n = Data.list("absences").filter(a => a.status === "pending" && a.approver === me).length + Data.list("reports").filter(r => r.status === "sent" && r.approver === me && r.who !== me).length;
    Apps.badge("company", n);
  }
  // Friday after 15:00: remind me once a week if this week's report isn't sent
  function remindCheck() {
    try {
      const cfg = repCfg(); if (!cfg.remind || cfg.period !== "week") return;
      const now = new Date(); if (now.getDay() !== 5 || now.getHours() < 15) return;
      if (Data.people().length < 2) return; // nobody to report to
      const wk = monday(Apps.today()), key = "lumen-hr-report-remind-" + (window.Cloud?.ws?.id || "local");
      if (ls(key) === wk || hasReport(ME(), wk)) return;
      ls(key, wk);
      window.Notify?.alert({ title: "📝 Time for your weekly report", body: "Share what you got done this week with your manager.", link: "#/app/company/reports", icon: "📝", tag: "hr-report-" + wk });
    } catch (e) { console.warn(e); }
  }
  let unPill = null, tick = null, unBg = [];
  function startBg() {
    unPill && unPill(); unPill = Data.on("timelog", pill); clearInterval(tick); tick = setInterval(pill, 30000);
    unBg.forEach(f => f()); unBg = ["absences", "reports", "settings"].map(c => Data.on(c, badge));
    Data.list("shifts"); // warm up: today's shift for the clock
  }

  Apps.register("company", { title: "Company & HR", icon: "🏢", render });
  Apps.HR = { managerOf, departments, headOf, isOut };
  Apps.Company = { clock, state, worked, hm, entryId, ABS, today: () => Data.get("timelog", entryId(Data.me().key, Apps.today())),
    requestTimeOff, openProfile, editProfile, isOut, shiftOf, lateBy, approverFor };
  Apps.onWorkspace.add(startBg);
  setTimeout(startBg, 0);
  setTimeout(remindCheck, 90000);
  setInterval(remindCheck, 10 * 60000);
})();
