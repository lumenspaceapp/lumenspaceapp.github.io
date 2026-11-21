/* Analytics (Bitrix24 "BI Builder"): ready dashboards for sales, tasks, team, booking, inventory and automation,
   custom dashboards (collection "dashboards") built from a gallery of metrics, filters, CSV export and print.
   Charts are small hand-written SVG/HTML helpers (no libraries). */
(function () {
  const { h, esc } = UI;
  const DAY = 864e5;
  const T = () => Apps.today();
  const me = () => Data.me().key;
  const num = v => +v || 0;
  const isoOf = ms => ms ? Apps.iso(new Date(ms)) : "";
  const wsId = () => window.Cloud?.ws?.id || "local";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("lumen-an-" + wsId() + "-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lumen-an-" + wsId() + "-" + k, JSON.stringify(v)); } catch {} },
  };
  const canView = app => { try { return Apps.can ? !!Apps.can(app, "view") : true; } catch { return true; } };
  const canCreate = () => { try { return Apps.can ? !!Apps.can("analytics", "edit") : true; } catch { return true; } };
  const isAdmin = () => { try { return Apps.isAdmin ? !!Apps.isAdmin() : true; } catch { return true; } };
  const pname = k => k ? (Data.person(k).name || String(k)) : "Nobody";
  const cap = s => { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const sum = (a, f = x => x) => a.reduce((s, x) => s + (num(f(x))), 0);
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };

  /* ---------- dates & periods ---------- */
  const dOf = s => new Date(s + "T00:00");
  const daysIn = (a, b) => Math.round((dOf(b) - dOf(a)) / DAY) + 1;
  const monday = d => Apps.addDays(d, -((dOf(d).getDay() + 6) % 7));
  const monthStart = d => d.slice(0, 7) + "-01";
  const addMonths = (d, n) => { const x = dOf(monthStart(d)); x.setMonth(x.getMonth() + n); return Apps.iso(x); };
  const monthEnd = d => Apps.addDays(addMonths(d, 1), -1);
  const quarterStart = d => { const x = dOf(d); return Apps.iso(new Date(x.getFullYear(), Math.floor(x.getMonth() / 3) * 3, 1)); };
  const minD = (a, b) => a < b ? a : b, maxD = (a, b) => a > b ? a : b;
  const inR = (d, a, b) => !!d && d >= a && d <= b;
  const fmtD = d => { if (!d) return ""; const x = dOf(d), y = x.getFullYear() !== new Date().getFullYear(); return x.toLocaleDateString(undefined, y ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }); };
  // times follow Settings → Region (Apps.fmtTime with "HH:MM", or the 24-hour switch) when available
  const time24 = () => !!(window.Prefs && Prefs.get("region.time24"));
  const fmtClock = ms => { try { const r = Apps.fmtTime?.(ms); if (r && !/invalid|nan/i.test(r)) return r; } catch {} return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const monLabel = (d, yr) => dOf(d).toLocaleDateString(undefined, yr ? { month: "short", year: "2-digit" } : { month: "short" });
  const WDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" })); // Monday first

  const PERIODS = [["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["12m", "Last 12 months"], ["custom", "Custom range"]];
  const periodName = k => (PERIODS.find(p => p[0] === k) || PERIODS[1])[1];
  // current range + the previous one to compare with (a period still in progress compares with the same number of days before)
  function range(f) {
    const t = T(); let from, to, pf, pt;
    switch (f.period) {
      case "week": from = monday(t); to = Apps.addDays(from, 6); pf = Apps.addDays(from, -7); pt = Apps.addDays(from, -1); break;
      case "lastmonth": from = addMonths(t, -1); to = monthEnd(from); pf = addMonths(t, -2); pt = monthEnd(pf); break;
      case "quarter": from = quarterStart(t); to = monthEnd(addMonths(from, 2)); pf = addMonths(from, -3); pt = Apps.addDays(from, -1); break;
      case "year": { const y = +t.slice(0, 4); from = y + "-01-01"; to = y + "-12-31"; pf = (y - 1) + "-01-01"; pt = (y - 1) + "-12-31"; break; }
      case "12m": from = addMonths(t, -11); to = monthEnd(t); pf = addMonths(t, -23); pt = Apps.addDays(from, -1); break;
      case "custom": {
        from = f.from || monthStart(t); to = f.to || t; if (to < from) [from, to] = [to, from];
        const n = daysIn(from, to); pt = Apps.addDays(from, -1); pf = Apps.addDays(from, -n); break;
      }
      default: from = monthStart(t); to = monthEnd(t); pf = addMonths(t, -1); pt = monthEnd(pf);
    }
    const running = t >= from && t <= to && f.period !== "custom";
    if (running) pt = minD(pt, Apps.addDays(pf, daysIn(from, t) - 1));
    return { from, to, pf, pt, running, period: f.period || "month" };
  }
  // time buckets for a range: days (≤ 31 days), weeks (≤ 120 days) or months
  function buckets(from, to) {
    const n = daysIn(from, to), out = [], multiYear = from.slice(0, 4) !== to.slice(0, 4);
    if (n <= 31) for (let d = from; d <= to; d = Apps.addDays(d, 1)) out.push({ from: d, to: d, label: n <= 7 ? WDAYS[(dOf(d).getDay() + 6) % 7] + " " + dOf(d).getDate() : String(dOf(d).getDate()), full: fmtD(d) });
    else if (n <= 120) for (let d = monday(from); d <= to; d = Apps.addDays(d, 7)) out.push({ from: maxD(d, from), to: minD(Apps.addDays(d, 6), to), label: fmtD(maxD(d, from)), full: "Week of " + fmtD(d) });
    else for (let d = monthStart(from); d <= to; d = addMonths(d, 1)) out.push({ from: maxD(d, from), to: minD(monthEnd(d), to), label: monLabel(d, multiYear), full: dOf(d).toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
    out.gran = n <= 31 ? "day" : n <= 120 ? "week" : "month";
    return out;
  }

  /* ---------- formatting ---------- */
  const moneyShort = v => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: Apps.currency(), notation: "compact", maximumFractionDigits: 1 }).format(v); } catch { return Apps.money(v); } };
  const nShort = v => { try { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v); } catch { return String(Math.round(v)); } };
  const r1 = v => Math.round(v * 10) / 10;
  function fmt(v, unit, compact) {
    if (v == null || Number.isNaN(+v)) return "—";
    v = +v;
    if (unit === "money") return compact ? moneyShort(v) : Apps.money(v);
    if (unit === "pct") return Math.round(v) + "%";
    if (unit === "hours") return (compact && v >= 1000 ? nShort(v) : (v >= 100 ? Math.round(v) : r1(v)).toLocaleString()) + " h";
    if (unit === "days") return r1(v).toLocaleString() + " d";
    return compact && Math.abs(v) >= 10000 ? nShort(v) : r1(v).toLocaleString();
  }
  const raw = v => typeof v === "number" ? Math.round(v * 100) / 100 : (v ?? "");
  // change vs previous period: percent, or points for rates
  function change(cur, prev, invert, unit) {
    if (prev === undefined || cur == null) return null;
    if (prev == null) return cur ? { up: true, good: !invert, text: "▲ new" } : { flat: true, text: "No change" };
    if (unit === "pct") { const d = Math.round(cur - prev); return !d ? { flat: true, text: "No change" } : { up: d > 0, good: invert ? d < 0 : d > 0, text: (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + " pts" }; }
    if (!prev) return cur ? { up: cur > 0, good: invert ? cur < 0 : cur > 0, text: cur > 0 ? "▲ new" : "▼" } : { flat: true, text: "No change" };
    const p = (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(p) < 0.5) return { flat: true, text: "No change" };
    return { up: p > 0, good: invert ? p < 0 : p > 0, text: (p > 0 ? "▲ " : "▼ ") + (Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))) + "%" };
  }

  /* ---------- data access (works even when an app file failed to load) ---------- */
  const DEF_STAGES = [["new", "New", "gray", "process"], ["qualified", "Qualified", "blue", "process"], ["proposal", "Proposal", "purple", "process"], ["negotiation", "Negotiation", "orange", "process"], ["won", "Won", "green", "won"], ["lost", "Lost", "red", "lost"]]
    .map(([id, name, color, sem]) => ({ id, name, color, sem }));
  const pipes = () => { try { const p = Apps.CRM?.pipelines?.(); if (Array.isArray(p) && p.length) return p; } catch {} return [{ id: "default", name: "Default pipeline", stages: DEF_STAGES }]; };
  const pipeOf = d => { const ps = pipes(); return (ps.find(p => p.id === (d.pipeline || "default")) || ps[0]).id; };
  const pipeName = d => (pipes().find(p => p.id === pipeOf(d)) || {}).name || "Pipeline";
  const stageOf = d => { try { if (Apps.CRM?.stageOf) return Apps.CRM.stageOf(d) || {}; } catch {} const ss = (pipes().find(p => p.id === pipeOf(d)) || {}).stages || DEF_STAGES; return ss.find(s => s.id === d.stage) || ss[0] || {}; };
  const semOf = d => stageOf(d).sem || "process";
  const closedOn = d => isoOf(d.closedAt || d.at);
  const live = col => Data.list(col).filter(x => x && !x.deleted);
  const deals = () => { try { if (Apps.CRM?.live) return Apps.CRM.live("deals"); } catch {} return live("deals"); };
  const leads = () => live("leads").filter(l => !l.mergedInto);
  const invoices = () => live("quotes").filter(q => q.kind === "invoice");
  const qTotal = q => { try { if (Apps.Sales?.totals) return num(Apps.Sales.totals(q.items || []).total); } catch {} return sum(q.items || [], it => num(it.qty) * num(it.price) * (1 - num(it.discount) / 100) * (1 + num(it.tax) / 100)); };
  const invStatus = q => { const s = q.status || "draft"; return s === "sent" || s === "overdue" ? (q.due && q.due < T() ? "overdue" : "sent") : s; };
  const INV_ST = { draft: "Draft", sent: "Unpaid", overdue: "Overdue", paid: "Paid", cancelled: "Cancelled" };
  const tasks = () => { try { if (Apps.liveTasks) return Apps.liveTasks(); } catch {} return Data.list("tasks").filter(t => !t.deleted && t.kind !== "template"); };
  const TASK_ST = { todo: "To do", doing: "In progress", review: "Waiting for approval", done: "Done" };
  const projName = id => (id && Data.get("projects", id)?.name) || "No project";
  const spent = t => num(t.timeSpent) + (t.tracking ? Math.max(0, (Date.now() - (t.tracking.since || Date.now())) / 1000) : 0);
  const workedMs = e => { try { if (Apps.Company?.worked) return Apps.Company.worked(e); } catch {} if (!e?.start) return 0; const end = e.end || Date.now(); return Math.max(0, end - e.start - sum(e.pauses || [], p => (p.e || end) - p.s)); };
  const lateMin = e => { try { const C = Apps.Company; return C?.lateBy && C.shiftOf ? num(C.lateBy(e, C.shiftOf(e.who, e.date))) : 0; } catch { return 0; } };
  const absStat = a => a.status || "approved";
  const ABS = () => Apps.Company?.ABS || { vacation: ["🌴 Vacation"], sick: ["🤒 Sick leave"], personal: ["🏠 Personal"], remote: ["💻 Remote"], trip: ["✈️ Business trip"] };
  const absLabel = t => (ABS()[t] || [cap(t || "Other")])[0];
  const absColor = t => (ABS()[t] || [])[1];
  const bkAll = () => Data.list("bookings");
  const bookings = () => bkAll().filter(b => b.kind === "booking" && !b.deleted && b.date);
  const bkRes = id => { const r = id && Data.get("bookings", id); return r && r.kind === "resource" ? r : null; };
  const bkSvc = id => { const s = id && Data.get("bookings", id); return s && s.kind === "service" ? s : null; };
  const BK_ST = { unconfirmed: "Not confirmed", confirmed: "Confirmed", late: "Late", noshow: "No-show", done: "Done", cancelled: "Cancelled" };
  const DEF_HOURS = { mon: ["09:00", "18:00"], tue: ["09:00", "18:00"], wed: ["09:00", "18:00"], thu: ["09:00", "18:00"], fri: ["09:00", "18:00"], sat: null, sun: null };
  const DKEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const products = () => live("products");
  const stockOf = p => { try { return window.InventoryAPI?.stock ? num(InventoryAPI.stock(p.id)) : 0; } catch { return 0; } };
  const invDocs = () => Data.list("inventory").filter(d => d.kind === "doc" && !d.deleted);
  const DOC_T = { receipt: "Receipt", sale: "Sale", transfer: "Transfer", writeoff: "Write-off" };
  const whName = id => (id && Data.get("inventory", id)?.name) || "No warehouse";
  const wfName = r => (r.workflow && Data.get("workflows", r.workflow)?.name) || r.name || "Approval";
  const WF_ST = { running: "Open", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };

  // fixed colors for labels that mean a state (always shown with their label, never color alone)
  const LABEL_COLOR = { Won: "var(--c-green)", Lost: "var(--c-red)", Paid: "var(--c-green)", Overdue: "var(--c-red)", Unpaid: "var(--an-1)", Draft: "var(--c-gray)", Cancelled: "var(--c-gray)",
    Approved: "var(--c-green)", Declined: "var(--c-red)", Open: "var(--c-orange)", Returned: "var(--c-orange)", Sent: "var(--an-1)", Done: "var(--c-green)", "No-show": "var(--c-red)",
    OK: "var(--c-green)", Failed: "var(--c-red)", "To do": "var(--c-gray)", "In progress": "var(--an-1)", "Waiting for approval": "var(--an-7)" };

  /* ---------- sources ---------- */
  const SRC = {
    crm: { label: "Sales", icon: "💼", app: "crm", cols: ["deals", "leads", "quotes", "settings", "history"] },
    tasks: { label: "Tasks", icon: "✅", app: "tasks", cols: ["tasks", "projects"] },
    team: { label: "Team", icon: "🏢", app: "company", cols: ["people", "timelog", "absences", "reports", "shifts", "settings"] },
    booking: { label: "Booking", icon: "🗓️", app: "booking", cols: ["bookings", "settings"] },
    inventory: { label: "Inventory", icon: "📦", app: "inventory", cols: ["inventory", "products"] },
    automation: { label: "Automation", icon: "⚡", app: "automation", cols: ["wfruns", "workflows", "rules"] },
  };
  const DIMS = { none: "Total", time: "Over time", person: "Person", stage: "Stage", pipeline: "Pipeline", source: "Source", status: "Status", project: "Project", priority: "Priority",
    dept: "Department", type: "Type", resource: "Resource", service: "Service", category: "Category", warehouse: "Warehouse", workflow: "Process", rule: "Rule", result: "Result", reason: "Reason", dayhour: "Day and hour" };
  const CHARTS = { kpi: ["Number", "🔢"], line: ["Line", "📈"], area: ["Area", "🏔️"], bar: ["Columns", "📊"], hbar: ["Bars", "📶"], donut: ["Donut", "🍩"], funnel: ["Funnel", "🔻"], table: ["Table", "📋"], heat: ["Heatmap", "🟪"] };

  /* ---------- metric definitions ----------
     rows() → records { date, v, person, ppl?, pipeline?, hour?, g: {dim: label}, c?: {dim: color}, item?: {…for tables} }
     agg "sum" (v defaults to 1, so counting = summing) or "avg"; snapshot metrics ignore the period. */
  const L = (label, key, unit) => ({ label, key, unit });
  const dealRec = (d, date, v) => {
    const st = stageOf(d);
    return { date, v, person: d.owner || d.by || "", pipeline: pipeOf(d), g: { stage: st.name || d.stage || "—", pipeline: pipeName(d), source: d.source || "Other", reason: d.closeReason || "No reason given" },
      c: { stage: `var(--c-${st.color || "gray"})` }, item: { title: d.title || "Untitled deal", stage: st.name || "—", owner: pname(d.owner), close: d.close || closedOn(d), amount: num(d.amount) } };
  };
  const DEAL_LIST = { cols: [L("Deal", "title"), L("Stage", "stage"), L("Responsible", "owner"), L("Amount", "amount", "money")] };
  const stageOrder = () => { const seen = new Set(); return pipes().flatMap(p => (p.stages || []).map(s => s.name)).filter(n => !seen.has(n) && seen.add(n)); };
  const taskRec = (t, date, v) => ({ date, v, person: t.assignee || t.by || "", ppl: [t.assignee, ...(t.participants || []), !t.assignee && t.by].filter(Boolean),
    g: { project: projName(t.project), status: TASK_ST[t.status || "todo"] || cap(t.status), priority: cap(t.priority || "normal") },
    item: { title: t.title || "Untitled task", who: pname(t.assignee || t.by), deadline: t.deadline || "", project: projName(t.project), hours: spent(t) / 3600 } });
  const TASK_LIST = { cols: [L("Task", "title"), L("Responsible", "who"), L("Deadline", "deadline", "date"), L("Project", "project")] };
  const invRec = (q, date, v) => ({ date, v, person: q.owner || q.by || "", g: { status: INV_ST[invStatus(q)] || cap(invStatus(q)) },
    item: { number: q.number || "—", title: q.title || (q.company && Data.get("companies", q.company)?.name) || (q.contact && Data.get("contacts", q.contact)?.name) || "", status: INV_ST[invStatus(q)], due: q.due || "", total: qTotal(q) } });
  const INV_LIST = { cols: [L("Invoice", "number"), L("Client", "title"), L("Status", "status"), L("Due", "due", "date"), L("Total", "total", "money")] };
  const bkRec = (b, v) => { const r = bkRes(b.resource), s = bkSvc(b.service); return { date: b.date, v, person: r?.person || "", hour: toMin(b.start) == null ? null : Math.floor(toMin(b.start) / 60),
    g: { resource: r?.name || "No resource", service: s?.name || "No service", status: BK_ST[b.status || "unconfirmed"] || cap(b.status) }, c: { resource: r?.color, service: s?.color },
    item: { client: b.client?.name || "—", date: b.date, start: b.start || "", resource: r?.name || "—", price: num(b.price) } }; };
  const BK_LIST = { cols: [L("Client", "client"), L("Date", "date", "date"), L("Time", "start"), L("Resource", "resource"), L("Price", "price", "money")] };
  const runRec = (r, date, v) => ({ date, v, person: r.by || "", g: { workflow: wfName(r), status: WF_ST[r.status] || cap(r.status) },
    item: { title: wfName(r), by: pname(r.by), started: isoOf(r.at), waiting: (r.waiting || []).map(pname).join(", ") || "—" } });
  const RUN_LIST = { cols: [L("Request", "title"), L("Requested by", "by"), L("Started", "started", "date"), L("Waiting for", "waiting")] };
  const prodRec = p => { const q = stockOf(p); return { date: null, v: q * num(p.price), person: "", g: { category: p.category || "No category" }, item: { name: p.name || "Product", stock: q, min: num(p.minStock), value: q * num(p.price) } }; };
  const tracked = () => products().filter(p => p.track || stockOf(p) !== 0);
  const isLow = p => { try { const low = window.InventoryAPI?.low?.(); if (Array.isArray(low)) return low.includes(p.id); } catch {} const q = stockOf(p); return p.track && (q <= 0 || (num(p.minStock) > 0 && q <= num(p.minStock))); };

  const METRICS = {};
  const def = (id, m) => { METRICS[id] = { id, agg: "sum", dims: [], ...m }; };

  // Sales
  def("deals_pipeline", { source: "crm", label: "Pipeline value", desc: "Total amount of open deals right now", unit: "money", snapshot: true, dims: ["person", "stage", "pipeline", "source"], order: { stage: stageOrder }, list: DEAL_LIST,
    rows: () => deals().filter(d => semOf(d) === "process").map(d => dealRec(d, null, num(d.amount))) });
  def("deals_open", { source: "crm", label: "Open deals", desc: "Number of deals in progress right now", unit: "count", snapshot: true, dims: ["person", "stage", "pipeline", "source"], order: { stage: stageOrder }, list: DEAL_LIST,
    rows: () => deals().filter(d => semOf(d) === "process").map(d => dealRec(d, null, 1)) });
  def("deals_won", { source: "crm", label: "Won amount", desc: "Amount of deals won, by the day they were won", unit: "money", dims: ["person", "pipeline", "source"], list: { cols: [L("Deal", "title"), L("Responsible", "owner"), L("Won on", "close", "date"), L("Amount", "amount", "money")] },
    rows: () => deals().filter(d => semOf(d) === "won").map(d => dealRec(d, closedOn(d), num(d.amount))) });
  def("deals_won_count", { source: "crm", label: "Deals won", desc: "Number of deals won", unit: "count", dims: ["person", "pipeline", "source"],
    rows: () => deals().filter(d => semOf(d) === "won").map(d => dealRec(d, closedOn(d), 1)) });
  def("deals_lost", { source: "crm", label: "Deals lost", desc: "Number of deals lost, and why", unit: "count", invert: true, dims: ["person", "pipeline", "reason"],
    rows: () => deals().filter(d => semOf(d) === "lost").map(d => dealRec(d, closedOn(d), 1)) });
  def("deals_new", { source: "crm", label: "New deals", desc: "Deals created in the period", unit: "count", dims: ["person", "stage", "pipeline", "source"], order: { stage: stageOrder }, list: DEAL_LIST,
    rows: () => deals().map(d => dealRec(d, isoOf(d.at), 1)) });
  def("win_rate", { source: "crm", label: "Win rate", desc: "Share of closed deals that were won", unit: "pct", agg: "avg", dims: ["person", "pipeline", "source"],
    rows: () => deals().filter(d => semOf(d) !== "process").map(d => dealRec(d, closedOn(d), semOf(d) === "won" ? 100 : 0)) });
  def("avg_deal", { source: "crm", label: "Average deal size", desc: "Average amount of won deals", unit: "money", agg: "avg", dims: ["person", "pipeline"],
    rows: () => deals().filter(d => semOf(d) === "won").map(d => dealRec(d, closedOn(d), num(d.amount))) });
  def("funnel", { source: "crm", label: "Sales funnel", desc: "How many deals reached each stage", unit: "count", groups: ["none"], charts: () => ["funnel", "hbar", "table"], custom: funnelData });
  def("leads_new", { source: "crm", label: "New leads", desc: "Leads created in the period", unit: "count", dims: ["person", "source", "status"],
    rows: () => leads().map(l => ({ date: isoOf(l.at), v: 1, person: l.owner || l.by || "", g: { source: l.source || "Other", status: cap(l.status || "new") } })) });
  def("lead_conv", { source: "crm", label: "Lead conversion", desc: "Share of new leads converted to deals", unit: "pct", agg: "avg", dims: ["person", "source"],
    rows: () => leads().map(l => ({ date: isoOf(l.at), v: l.status === "converted" ? 100 : 0, person: l.owner || l.by || "", g: { source: l.source || "Other" } })) });
  def("inv_issued", { source: "crm", label: "Invoiced", desc: "Invoices issued in the period, by status", unit: "money", dims: ["status", "person"], order: { status: () => ["Paid", "Unpaid", "Overdue", "Draft"] }, list: INV_LIST,
    rows: () => invoices().filter(q => q.status !== "cancelled").map(q => invRec(q, q.issue || isoOf(q.at), qTotal(q))) });
  def("inv_paid", { source: "crm", label: "Paid invoices", desc: "Money received, by the day invoices were paid", unit: "money", dims: ["person"], list: INV_LIST,
    rows: () => invoices().filter(q => q.status === "paid").map(q => invRec(q, isoOf(q.paidAt) || q.issue, qTotal(q))) });
  def("inv_unpaid", { source: "crm", label: "Outstanding invoices", desc: "Sent invoices not paid yet, right now", unit: "money", snapshot: true, invert: true, dims: ["status", "person"], list: INV_LIST,
    rows: () => invoices().filter(q => ["sent", "overdue"].includes(invStatus(q))).map(q => invRec(q, null, qTotal(q))) });

  // Tasks
  def("tasks_open", { source: "tasks", label: "Open tasks", desc: "Tasks not done yet, right now", unit: "count", snapshot: true, dims: ["person", "project", "status", "priority"], list: TASK_LIST,
    order: { status: () => ["To do", "In progress", "Waiting for approval"] }, rows: () => tasks().filter(t => t.status !== "done").map(t => taskRec(t, null, 1)) });
  def("tasks_overdue", { source: "tasks", label: "Overdue tasks", desc: "Open tasks past their deadline", unit: "count", snapshot: true, invert: true, dims: ["person", "project", "priority"], list: TASK_LIST,
    rows: () => tasks().filter(t => t.status !== "done" && t.status !== "review" && t.deadline && t.deadline < T()).map(t => taskRec(t, null, 1)) });
  def("tasks_done", { source: "tasks", label: "Tasks completed", desc: "Tasks finished in the period", unit: "count", heat: true, dims: ["person", "project", "priority"], list: TASK_LIST,
    rows: () => tasks().filter(t => t.status === "done" && t.completedAt).map(t => ({ ...taskRec(t, isoOf(t.completedAt), 1), hour: new Date(t.completedAt).getHours() })) });
  def("tasks_created", { source: "tasks", label: "Tasks created", desc: "Tasks added in the period", unit: "count", dims: ["person", "project", "priority"],
    rows: () => tasks().filter(t => t.at).map(t => taskRec(t, isoOf(t.at), 1)) });
  def("tasks_ontime", { source: "tasks", label: "On-time rate", desc: "Share of finished tasks done by their deadline", unit: "pct", agg: "avg", dims: ["person", "project"],
    rows: () => tasks().filter(t => t.status === "done" && t.completedAt).map(t => taskRec(t, isoOf(t.completedAt), !t.deadline || isoOf(t.completedAt) <= t.deadline ? 100 : 0)) });
  def("time_tracked", { source: "tasks", label: "Time tracked", desc: "Hours tracked on tasks (finished tasks by finish day, open ones today)", unit: "hours", dims: ["person", "project"],
    list: { cols: [L("Task", "title"), L("Responsible", "who"), L("Project", "project"), L("Time", "hours", "hours")] },
    rows: () => tasks().filter(t => spent(t) > 0).map(t => taskRec(t, t.status === "done" && t.completedAt ? isoOf(t.completedAt) : T(), spent(t) / 3600)) });

  // Team
  const deptOf = k => (Data.people().find(p => p.key === k) || {}).dept || "No department";
  def("headcount", { source: "team", label: "Headcount", desc: "People in the workspace", unit: "count", snapshot: true, noPerson: true, dims: ["dept"],
    list: { cols: [L("Name", "name"), L("Job title", "title"), L("Department", "dept")] },
    rows: () => Data.people().map(p => ({ date: null, v: 1, person: p.key, g: { dept: p.dept || "No department" }, item: { name: p.name, title: p.title || "", dept: p.dept || "—" } })) });
  def("present_today", { source: "team", label: "Present today", desc: "People who clocked in today", unit: "count", snapshot: true, dims: ["dept"],
    list: { cols: [L("Name", "name"), L("Clocked in", "start"), L("Worked", "hours", "hours")] },
    rows: () => Data.list("timelog").filter(e => e.date === T() && e.start).map(e => ({ date: null, v: 1, person: e.who, g: { dept: deptOf(e.who) },
      item: { name: pname(e.who), start: fmtClock(e.start), hours: workedMs(e) / 36e5 } })) });
  def("out_today", { source: "team", label: "Out today", desc: "People on approved leave today", unit: "count", snapshot: true, dims: ["type", "dept"],
    list: { cols: [L("Name", "name"), L("Type", "type"), L("Back after", "to", "date")] },
    rows: () => Data.list("absences").filter(a => absStat(a) === "approved" && inR(T(), a.from, a.to || a.from)).map(a => ({ date: null, v: 1, person: a.who, g: { type: absLabel(a.type), dept: deptOf(a.who) },
      c: { type: absColor(a.type) }, item: { name: pname(a.who), type: absLabel(a.type), to: a.to || a.from } })) });
  def("hours_worked", { source: "team", label: "Hours worked", desc: "Clocked hours from the worktime log", unit: "hours", dims: ["person", "dept"],
    rows: () => Data.list("timelog").filter(e => e.start && e.date).map(e => ({ date: e.date, v: workedMs(e) / 36e5, person: e.who, g: { dept: deptOf(e.who) } })) });
  def("late", { source: "team", label: "Late arrivals", desc: "Clock-ins more than 10 minutes after the planned shift", unit: "count", invert: true, dims: ["person", "dept"],
    list: { cols: [L("Name", "name"), L("Date", "date", "date"), L("Minutes late", "min")] },
    rows: () => Data.list("timelog").filter(e => e.start && e.date).map(e => [e, lateMin(e)]).filter(([, m]) => m > 0)
      .map(([e, m]) => ({ date: e.date, v: 1, person: e.who, g: { dept: deptOf(e.who) }, item: { name: pname(e.who), date: e.date, min: m } })) });
  def("absence_days", { source: "team", label: "Absence days", desc: "Working days of approved leave", unit: "days", dims: ["type", "person", "dept"], rows: absenceRows });
  def("reports_sent", { source: "team", label: "Reports submitted", desc: "Work reports sent, by status", unit: "count", dims: ["status", "person"], order: { status: () => ["Approved", "Sent", "Returned"] },
    rows: () => Data.list("reports").map(r => ({ date: r.from || isoOf(r.at), v: 1, person: r.who || r.by, g: { status: cap(r.status || "sent") } })) });
  def("reports_approved", { source: "team", label: "Reports approved", desc: "Work reports approved", unit: "count", dims: ["person"],
    rows: () => Data.list("reports").filter(r => r.status === "approved").map(r => ({ date: r.from || isoOf(r.at), v: 1, person: r.who || r.by, g: {} })) });

  // Booking
  def("bookings", { source: "booking", label: "Bookings", desc: "Appointments (cancelled ones not counted)", unit: "count", heat: true, dims: ["resource", "service", "status"], list: BK_LIST,
    rows: () => bookings().filter(b => b.status !== "cancelled").map(b => bkRec(b, 1)) });
  def("bk_revenue", { source: "booking", label: "Booking revenue", desc: "Price of bookings that took place or are planned", unit: "money", dims: ["resource", "service"], list: BK_LIST,
    rows: () => bookings().filter(b => b.status !== "cancelled" && b.status !== "noshow").map(b => bkRec(b, num(b.price))) });
  def("noshows", { source: "booking", label: "No-shows", desc: "Clients who didn't come", unit: "count", invert: true, dims: ["resource", "service"], list: BK_LIST,
    rows: () => bookings().filter(b => b.status === "noshow").map(b => bkRec(b, 1)) });
  def("utilisation", { source: "booking", label: "Utilisation", desc: "Booked time vs working hours of active resources", unit: "pct", agg: "avg", groups: ["none", "time", "resource"],
    charts: g => g === "none" ? ["kpi"] : g === "time" ? ["line", "area", "bar"] : ["hbar", "bar", "table"], custom: utilData });

  // Inventory
  def("stock_value", { source: "inventory", label: "Stock value", desc: "Stock on hand at sale price, right now", unit: "money", snapshot: true, noPerson: true, dims: ["category"],
    list: { cols: [L("Product", "name"), L("In stock", "stock"), L("Value", "value", "money")] }, rows: () => tracked().map(prodRec) });
  def("low_stock", { source: "inventory", label: "Low stock items", desc: "Products at or below their minimum", unit: "count", snapshot: true, noPerson: true, invert: true, dims: ["category"],
    list: { cols: [L("Product", "name"), L("In stock", "stock"), L("Minimum", "min")], sort: (a, b) => a.item.stock - b.item.stock }, rows: () => tracked().filter(isLow).map(p => ({ ...prodRec(p), v: 1 })) });
  const docRec = (d, v) => ({ date: d.date || isoOf(d.at), v, person: d.by || "", g: { type: DOC_T[d.type] || cap(d.type), warehouse: whName(d.warehouse) },
    item: { number: d.number || "—", type: DOC_T[d.type] || cap(d.type), date: d.date || isoOf(d.at), units: sum(d.items || [], it => it.qty) } });
  def("inv_moves", { source: "inventory", label: "Stock movements", desc: "Conducted receipts, sales, transfers and write-offs", unit: "count", dims: ["type", "warehouse", "person"],
    list: { cols: [L("Document", "number"), L("Type", "type"), L("Date", "date", "date"), L("Units", "units")] }, rows: () => invDocs().filter(d => d.status === "done").map(d => docRec(d, 1)) });
  def("inv_units", { source: "inventory", label: "Units moved", desc: "Quantity in conducted stock documents", unit: "count", dims: ["type", "warehouse"],
    rows: () => invDocs().filter(d => d.status === "done").map(d => docRec(d, sum(d.items || [], it => it.qty))) });

  // Automation
  def("approvals", { source: "automation", label: "Approval requests", desc: "Requests started in the period, by result", unit: "count", dims: ["status", "workflow", "person"], order: { status: () => ["Open", "Approved", "Declined", "Cancelled"] }, list: RUN_LIST,
    rows: () => Data.list("wfruns").map(r => runRec(r, isoOf(r.at), 1)) });
  def("approvals_open", { source: "automation", label: "Open approvals", desc: "Requests waiting for a decision, right now", unit: "count", snapshot: true, dims: ["workflow", "person"], list: RUN_LIST,
    rows: () => Data.list("wfruns").filter(r => r.status === "running").map(r => runRec(r, null, 1)) });
  def("approvals_approved", { source: "automation", label: "Approved", desc: "Requests approved in the period", unit: "count", dims: ["workflow", "person"],
    rows: () => Data.list("wfruns").filter(r => r.status === "approved").map(r => runRec(r, isoOf(r.finishedAt || r.at), 1)) });
  def("approvals_declined", { source: "automation", label: "Declined", desc: "Requests declined in the period", unit: "count", dims: ["workflow", "person"],
    rows: () => Data.list("wfruns").filter(r => r.status === "declined").map(r => runRec(r, isoOf(r.finishedAt || r.at), 1)) });
  def("decision_time", { source: "automation", label: "Average decision time", desc: "Hours from request to final decision", unit: "hours", agg: "avg", invert: true, dims: ["workflow"],
    rows: () => Data.list("wfruns").filter(r => (r.status === "approved" || r.status === "declined") && r.finishedAt && r.at).map(r => runRec(r, isoOf(r.finishedAt), Math.max(0, r.finishedAt - r.at) / 36e5)) });
  def("rule_runs", { source: "automation", label: "Rule runs", desc: "Automation rule runs (each rule keeps its last 20)", unit: "count", dims: ["rule", "result", "person"],
    rows: () => Data.list("rules").filter(r => r.trigger).flatMap(r => (r.log || []).filter(x => x && x.at).map(x => ({ date: isoOf(x.at), v: 1, person: x.by || "", g: { rule: r.name || "Rule", result: x.ok === false ? "Failed" : "OK" } }))) });

  function absenceRows() {
    const out = [];
    Data.list("absences").filter(a => absStat(a) === "approved" && a.from).forEach(a => {
      const to = a.to && a.to > a.from ? a.to : a.from, half = a.half && to === a.from;
      let d = a.from;
      for (let i = 0; d <= to && i < 800; i++, d = Apps.addDays(d, 1)) {
        const wd = dOf(d).getDay(); if (wd === 0 || wd === 6) continue;
        out.push({ date: d, v: half ? 0.5 : 1, person: a.who, g: { type: absLabel(a.type), dept: deptOf(a.who) }, c: { type: absColor(a.type) } });
      }
    });
    return out;
  }

  // funnel: deals active in the period (created before it ends, still open or closed inside it), furthest stage reached
  function funnelData(ctx, g, type) {
    const ps = pipes(), P = ps.find(p => p.id === ctx.pipeline) || ps.find(p => p.id === "default") || ps[0], stages = P.stages || [];
    const order = [...stages.filter(s => s.sem === "process"), ...stages.filter(s => s.sem === "won")];
    const lostFrom = {};
    Data.list("history").filter(x => x.col === "deals" && x.action === "stage" && x.fields?.stage).sort((a, b) => (a.at || 0) - (b.at || 0)).forEach(x => {
      const nw = stages.find(s => s.id === x.fields.stage[1]); if (nw && nw.sem === "lost") lostFrom[x.id] = x.fields.stage[0];
    });
    const ds = deals().filter(d => pipeOf(d) === P.id && (!ctx.person || d.owner === ctx.person) && isoOf(d.at || Date.now()) <= ctx.to && (semOf(d) === "process" || closedOn(d) >= ctx.from));
    const idx = d => { const s = stageOf(d); if (s.sem === "won") return order.length - 1; if (s.sem === "lost") return Math.max(0, order.findIndex(o => o.id === lostFrom[d.id])); return Math.max(0, order.findIndex(o => o.id === s.id)); };
    const steps = order.map((s, i) => { const r = ds.filter(d => idx(d) >= i); return { label: s.name, value: r.length, amount: sum(r, d => d.amount), color: `var(--c-${s.color || "gray"})` }; });
    if (type === "funnel") return { shape: "funnel", steps, unit: "count", note: ps.length > 1 ? P.name : "" };
    return { shape: "group", items: steps.map(s => ({ label: s.label, value: s.value, color: s.color })), unit: "count", dim: "Stage", ordered: true };
  }
  // booking utilisation: booked minutes / working minutes of active resources
  function utilOf(from, to, ctx, resId) {
    const st = Data.get("settings", "booking") || {}, hours = { ...DEF_HOURS, ...(st.hours || {}) };
    const rs = bkAll().filter(r => r.kind === "resource" && r.active !== false && !r.deleted && (!resId || r.id === resId) && (!ctx.person || r.person === ctx.person));
    if (!rs.length) return null;
    let open = 0;
    for (let d = from, i = 0; d <= to && i < 800; d = Apps.addDays(d, 1), i++) { const x = hours[DKEY[dOf(d).getDay()]]; if (x && x[0] && x[1]) open += Math.max(0, toMin(x[1]) - toMin(x[0])); }
    open *= rs.length;
    const ids = new Set(rs.map(r => r.id));
    const booked = sum(bookings().filter(b => b.status !== "cancelled" && ids.has(b.resource) && inR(b.date, from, to)), b => Math.max(0, (toMin(b.finish) ?? 0) - (toMin(b.start) ?? 0)));
    return open ? Math.min(100, booked / open * 100) : null;
  }
  function utilData(ctx, g, type) {
    const bs = buckets(ctx.from, ctx.to);
    if (type === "kpi" || g === "none") return { shape: "kpi", value: utilOf(ctx.from, ctx.to, ctx), prev: utilOf(ctx.pf, ctx.pt, ctx), unit: "pct", spark: bs.map(b => utilOf(b.from, b.to, ctx) || 0) };
    if (g === "time") return { shape: "series", labels: bs.map(b => b.label), full: bs.map(b => b.full), gran: bs.gran, unit: "pct", series: [{ name: "Utilisation", values: bs.map(b => utilOf(b.from, b.to, ctx) ?? 0), color: "var(--accent)" }] };
    const items = bkAll().filter(r => r.kind === "resource" && r.active !== false && !r.deleted && (!ctx.person || r.person === ctx.person))
      .map(r => ({ label: r.name || "Resource", value: utilOf(ctx.from, ctx.to, ctx, r.id) ?? 0, color: r.color })).sort((a, b) => b.value - a.value);
    return { shape: "group", items, unit: "pct", dim: "Resource" };
  }

  /* ---------- engine ---------- */
  let rowCache = new Map();
  const resetCache = () => { rowCache = new Map(); };
  const rowsOf = m => { if (!rowCache.has(m.id)) { let r = []; try { r = m.rows() || []; } catch (e) { console.error(e); } rowCache.set(m.id, r); } return rowCache.get(m.id); };
  const pass = (r, ctx, m) => {
    if (ctx.person && !m.noPerson && !(r.ppl || [r.person]).includes(ctx.person)) return false;
    if (ctx.pipeline && r.pipeline && r.pipeline !== ctx.pipeline) return false;
    return true;
  };
  const agg = (m, rs) => m.agg === "avg" ? (rs.length ? sum(rs, r => r.v ?? 1) / rs.length : null) : sum(rs, r => r.v ?? 1);
  const groupsOf = m => m.groups || ["none", ...(m.snapshot ? [] : ["time"]), ...(m.dims || []), ...(m.heat ? ["dayhour"] : [])];
  function chartsFor(m, g) {
    if (m.charts) return m.charts(g);
    if (g === "none") return m.list ? ["kpi", "table"] : ["kpi"];
    if (g === "time") return ["line", "area", "bar"];
    if (g === "dayhour") return ["heat"];
    return m.agg === "avg" ? ["bar", "hbar", "table"] : ["bar", "hbar", "donut", "table"];
  }
  const dimKey = (r, g) => g === "person" ? (r.person || "") : g === "dept" && !r.g?.dept ? deptOf(r.person) : (r.g && r.g[g]) || "—";

  function compute(w, ctx) {
    const m = METRICS[w.metric];
    if (!m) return { err: "This metric is no longer available." };
    if (!canView(SRC[m.source].app)) return { locked: SRC[m.source].label };
    const g = w.groupBy || "none", type = w.type || "kpi";
    if (m.custom) return m.custom(ctx, g, type, w);
    const all = rowsOf(m).filter(r => pass(r, ctx, m));
    const cur = m.snapshot ? all : all.filter(r => inR(r.date, ctx.from, ctx.to));
    if (type === "kpi") {
      const bs = m.snapshot ? null : buckets(ctx.from, ctx.to);
      return { shape: "kpi", value: agg(m, cur), prev: m.snapshot ? undefined : agg(m, all.filter(r => inR(r.date, ctx.pf, ctx.pt))), unit: m.unit, invert: m.invert,
        spark: bs && bs.map(b => agg(m, cur.filter(r => inR(r.date, b.from, b.to))) || 0), sub: m.snapshot ? "right now" : "" };
    }
    if (type === "heat") {
      const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
      cur.forEach(r => { if (r.hour == null || r.hour < 0 || r.hour > 23) return; grid[(dOf(r.date).getDay() + 6) % 7][r.hour] += r.v ?? 1; });
      return { shape: "heat", grid, unit: m.unit, label: m.label };
    }
    if (g === "time") {
      const bs = buckets(ctx.from, ctx.to);
      const ser = (mm, color) => { const rs = rowsOf(mm).filter(r => pass(r, ctx, mm)); return { name: mm.label, color, values: bs.map(b => agg(mm, rs.filter(r => inR(r.date, b.from, b.to))) ?? (mm.agg === "avg" ? null : 0)) }; };
      const extra = (w.options?.extra || []).map(id => METRICS[id]).filter(x => x && !x.snapshot && !x.custom && x.unit === m.unit && canView(SRC[x.source].app));
      const series = [ser(m, extra.length ? "var(--an-1)" : "var(--accent)"), ...extra.map((x, i) => ser(x, `var(--an-${i + 2})`))];
      return { shape: "series", labels: bs.map(b => b.label), full: bs.map(b => b.full), gran: bs.gran, unit: m.unit, series };
    }
    if (g === "none" && type === "table" && m.list) {
      const rows = cur.filter(r => r.item).sort(m.list.sort || ((a, b) => (b.v ?? 0) - (a.v ?? 0)));
      return { shape: "table", cols: m.list.cols, rows: rows.map(r => m.list.cols.map(c => r.item[c.key])) };
    }
    if (g === "none") return { shape: "kpi", value: agg(m, cur), unit: m.unit };
    const map = new Map();
    cur.forEach(r => { const k = dimKey(r, g); if (!map.has(k)) map.set(k, { rs: [], color: r.c?.[g] }); map.get(k).rs.push(r); });
    let items = [...map.entries()].map(([k, x]) => ({ label: g === "person" ? pname(k) : String(k), person: g === "person" && k ? k : null, value: agg(m, x.rs) ?? 0, color: x.color || LABEL_COLOR[k] }));
    const ord = m.order?.[g]?.();
    if (ord) items.sort((a, b) => { const ia = ord.indexOf(a.label), ib = ord.indexOf(b.label); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || b.value - a.value; });
    else items.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    return { shape: "group", items, unit: m.unit, dim: DIMS[g] || g, ordered: !!ord };
  }
  const safeCompute = (w, ctx) => { try { return compute(w, ctx); } catch (e) { console.error(e); return { err: "Couldn't calculate this widget." }; } };
  // categorical colors: fixed slots by alphabetical position among the groups shown (stable when values change)
  const safeColor = c => typeof c === "string" && /^(#[0-9a-f]{3,8}|var\(--[\w-]+\)|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i.test(c.trim()) ? c.trim() : "";
  function colorize(items) {
    items = items.map(x => ({ ...x, color: safeColor(x.color) }));
    const names = [...new Set(items.filter(x => !x.color).map(x => x.label))].sort((a, b) => a.localeCompare(b));
    return items.map(x => ({ ...x, color: x.color || (x.other ? "var(--c-gray)" : `var(--an-${(names.indexOf(x.label) % 8) + 1})`) }));
  }
  const isEmpty = d => d.shape === "series" ? !d.series.some(s => s.values.some(v => v)) : d.shape === "group" ? !d.items.some(x => x.value) : d.shape === "table" ? !d.rows.length
    : d.shape === "heat" ? !d.grid.some(r => r.some(Boolean)) : d.shape === "funnel" ? !d.steps.some(s => s.value) : false;

  /* ---------- tooltip ---------- */
  let tipEl = null;
  function showTip(text, x, y) {
    if (!tipEl) { tipEl = h("div", { class: "an-tip glass-strong", role: "tooltip" }); (document.getElementById("layer") || document.body).append(tipEl); }
    tipEl.textContent = text; tipEl.classList.add("on");
    const w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + ht > innerHeight - 8) top = y - ht - 14;
    tipEl.style.left = Math.max(8, left) + "px"; tipEl.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => tipEl?.classList.remove("on");
  function tipEvents(el) {
    const on = e => { const t = e.target.closest?.("[data-tip]"); if (t && el.contains(t) && t.dataset.tip) showTip(t.dataset.tip, e.clientX, e.clientY); else hideTip(); };
    el.addEventListener("pointermove", on); el.addEventListener("pointerdown", on); el.addEventListener("pointerleave", hideTip);
  }
  const attr = s => esc(s).replace(/\n/g, "&#10;");

  /* ---------- charts ---------- */
  const HEIGHT = { s: 130, m: 220, l: 260 };
  function ticks(max, unit) {
    if (!(max > 0)) return [0, unit === "pct" ? 100 : 1];
    const raw0 = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw0)));
    let step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw0) || raw0;
    if (unit === "count" && step < 1) step = 1;
    const top = Math.ceil(max / step - 1e-9) * step, out = [];
    for (let v = 0; v <= top + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  const trunc = (s, n) => (s = String(s), n < 2 ? "" : s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);
  function axes(W, H, tk, unit) {
    const tl = tk.map(t => fmt(t, unit, true)), pl = Math.max(24, Math.max(...tl.map(s => s.length)) * 6.3 + 10), pr = 10, pt = 10, pb = 24;
    const ih = H - pt - pb, top = tk[tk.length - 1] || 1, Y = v => pt + ih - (Math.max(0, v) / top) * ih;
    const grid = tk.map((t, i) => `<line class="an-gl${t === 0 ? " base" : ""}" x1="${pl}" x2="${W - pr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="an-ax" x="${pl - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(tl[i])}</text>`).join("");
    return { pl, pr, pt, pb, iw: W - pl - pr, ih, Y, grid };
  }
  let gid = 0;
  function lineChart(box, d, o) {
    const W = Math.max(200, box.clientWidth || 320), H = HEIGHT[o.size] || 220, n = d.labels.length;
    const vals = d.series.flatMap(s => s.values.map(v => v || 0)), tk = ticks(Math.max(0, ...vals), d.unit);
    const A = axes(W, H, tk, d.unit), X = i => A.pl + (n <= 1 ? A.iw / 2 : i * A.iw / (n - 1)), id = "ang" + (++gid);
    let s = `<svg class="an-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(o.title || "")}"><defs>`
      + d.series.map((se, k) => `<linearGradient id="${id}-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${se.color};stop-opacity:.3"/><stop offset="1" style="stop-color:${se.color};stop-opacity:0"/></linearGradient>`).join("") + `</defs>` + A.grid;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(A.iw / 58))));
    d.labels.forEach((l, i) => { if (i % every) return; const anc = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"; s += `<text class="an-ax" x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${anc}">${esc(trunc(l, Math.floor(58 * every / 6.5)))}</text>`; });
    d.series.forEach((se, k) => {
      const pts = se.values.map((v, i) => [X(i), A.Y(v || 0)]), line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
      if (o.area && n > 1) s += `<path class="an-area" d="${line}L${X(n - 1).toFixed(1)},${A.Y(0).toFixed(1)}L${X(0).toFixed(1)},${A.Y(0).toFixed(1)}Z" style="fill:url(#${id}-${k})"/>`;
      if (n > 1) s += `<path class="an-line" pathLength="1" d="${line}" style="stroke:${se.color}"/>`;
      if (n <= 16 || n === 1) pts.forEach((p, i) => { s += `<circle class="an-pt" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" style="stroke:${se.color};animation-delay:${300 + i * 25}ms"/>`; });
    });
    s += `<line class="an-guide" x1="0" x2="0" y1="${A.pt}" y2="${A.pt + A.ih}"/><g class="an-hdots"></g><rect class="an-hit" x="${A.pl - 6}" y="0" width="${A.iw + 12}" height="${H}"/></svg>`;
    if (d.series.length > 1) s += legend(d.series.map(se => ({ label: se.name, color: se.color })));
    box.innerHTML = s;
    const hit = box.querySelector(".an-hit"), guide = box.querySelector(".an-guide"), dots = box.querySelector(".an-hdots");
    hit.addEventListener("pointermove", e => {
      const r = hit.getBoundingClientRect(), i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - 6) / (r.width - 12) * (n - 1))));
      guide.setAttribute("x1", X(i)); guide.setAttribute("x2", X(i)); guide.classList.add("on");
      dots.innerHTML = d.series.map(se => `<circle cx="${X(i)}" cy="${A.Y(se.values[i] || 0)}" r="5" class="an-hdot" style="stroke:${se.color}"/>`).join("");
      hit.dataset.tip = [d.full?.[i] || d.labels[i], ...d.series.map(se => (d.series.length > 1 ? se.name + ": " : "") + fmt(se.values[i], d.unit))].join("\n");
    });
    hit.addEventListener("pointerleave", () => { guide.classList.remove("on"); dots.innerHTML = ""; });
  }
  const barPath = (x, y, w, hh, r) => { if (hh <= 0) return ""; r = Math.min(r, w / 2, hh); return `M${x.toFixed(1)},${(y + hh).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + hh).toFixed(1)}Z`; };
  function barChart(box, d, o) {
    const W = Math.max(200, box.clientWidth || 320), H = HEIGHT[o.size] || 220, n = d.labels.length, k = d.series.length;
    const tk = ticks(Math.max(0, ...d.series.flatMap(s => s.values.map(v => v || 0))), d.unit), A = axes(W, H, tk, d.unit);
    const band = A.iw / Math.max(1, n), inner = Math.min(band * .72, 46 * k), bw = Math.max(2, (inner - (k - 1) * 2) / k);
    let s = `<svg class="an-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(o.title || "")}">` + A.grid;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(A.iw / 52))));
    d.labels.forEach((l, i) => {
      const x0 = A.pl + i * band + (band - inner) / 2;
      d.series.forEach((se, j) => { const v = se.values[i] || 0, hh = v / (tk[tk.length - 1] || 1) * A.ih; s += `<path class="an-bar" d="${barPath(x0 + j * (bw + 2), A.pt + A.ih - hh, bw, hh, 4)}" style="fill:${se.color};animation-delay:${Math.min(i * 22, 500)}ms"/>`; });
      if (i % every === 0) s += `<text class="an-ax" x="${(A.pl + i * band + band / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(trunc(l, Math.floor(band * every / 6.6)))}</text>`;
      s += `<rect class="an-band" x="${(A.pl + i * band).toFixed(1)}" y="${A.pt}" width="${band.toFixed(1)}" height="${A.ih}" data-tip="${attr([d.full?.[i] || l, ...d.series.map(se => (k > 1 ? se.name + ": " : "") + fmt(se.values[i], d.unit))].join("\n"))}"/>`;
    });
    s += `</svg>`;
    if (k > 1) s += legend(d.series.map(se => ({ label: se.name, color: se.color })));
    box.innerHTML = s;
  }
  const legend = items => `<div class="an-legend">${items.map(x => `<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join("")}</div>`;
  function hbars(box, d, o) {
    const items = d.items, top = Math.max(...items.map(x => Math.abs(x.value || 0)), 0) || 1, N = o.top || (o.size === "l" ? 14 : o.size === "s" ? 5 : 8);
    const total = o.avg || d.unit === "pct" ? 0 : sum(items, x => x.value);
    box.replaceChildren(h("div", { class: "an-hbars" }, ...items.slice(0, N).map((x, i) => h("div", { class: "an-hrow", dataset: { tip: x.label + "\n" + fmt(x.value, d.unit) + (total ? ` · ${Math.round(x.value / total * 100)}%` : "") } },
      h("span", { class: "an-hl" }, x.person ? Apps.avatar(Data.person(x.person), 20) : null, h("span", { class: "tt", text: x.label })),
      h("span", { class: "an-htrack" }, h("i", { style: { width: Math.max(x.value ? 1.5 : 0, Math.abs(x.value || 0) / top * 100) + "%", background: x.color && o.colored ? x.color : "var(--accent)", animationDelay: i * 45 + "ms" } })),
      h("b", { class: "an-hv", text: fmt(x.value, d.unit) }))),
      items.length > N ? h("div", { class: "an-more", text: `+ ${items.length - N} more · download the CSV for all` }) : null));
  }
  function donut(box, d, o) {
    let list = d.items.filter(x => x.value > 0);
    if (list.length > 7) { const rest = list.slice(6); list = [...list.slice(0, 6), { label: `Other (${rest.length})`, value: sum(rest, x => x.value), other: true }]; }
    list = colorize(list);
    const total = sum(list, x => x.value), S = o.size === "s" ? 112 : 150, R = S / 2 - 11, C = 2 * Math.PI * R;
    let off = 0;
    const segs = list.map((x, i) => {
      const len = x.value / total * C, gap = list.length > 1 ? Math.min(2, len * .3) : 0;
      const seg = `<circle class="an-seg" r="${R.toFixed(2)}" cx="${S / 2}" cy="${S / 2}" style="stroke:${x.color};stroke-dasharray:${(len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)};stroke-dashoffset:${(-off).toFixed(2)};animation-delay:${i * 70}ms" data-tip="${attr(x.label + "\n" + fmt(x.value, d.unit) + " · " + Math.round(x.value / total * 100) + "%")}"/>`;
      off += len; return seg;
    }).join("");
    box.innerHTML = `<div class="an-donut"><div class="an-dsvg" style="width:${S}px;height:${S}px"><svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${attr(o.title || "")}"><circle r="${R}" cx="${S / 2}" cy="${S / 2}" class="an-track"/><g transform="rotate(-90 ${S / 2} ${S / 2})">${segs}</g></svg>`
      + `<div class="an-dc"><b>${esc(fmt(total, d.unit, true))}</b><small>total</small></div></div>`
      + `<div class="an-dleg">${list.map(x => `<div class="an-dl" data-tip="${attr(x.label + "\n" + fmt(x.value, d.unit))}"><i style="background:${x.color}"></i><span class="tt">${esc(x.label)}</span><b>${esc(fmt(x.value, d.unit, true))}</b><small>${Math.round(x.value / total * 100)}%</small></div>`).join("")}</div></div>`;
  }
  function funnelView(box, d) {
    const top = Math.max(1, d.steps[0]?.value || 0);
    box.replaceChildren(h("div", { class: "an-funnel" }, ...d.steps.map((s, i) => {
      const prev = i ? d.steps[i - 1].value : null, conv = prev == null ? null : prev ? Math.round(s.value / prev * 100) : 0;
      return h("div", { class: "an-fr", dataset: { tip: `${s.label}\n${s.value} deal${s.value === 1 ? "" : "s"} · ${Apps.money(s.amount)}${conv == null ? "" : `\n${conv}% from the previous stage`}` } },
        h("span", { class: "an-fl tt", text: s.label }),
        h("span", { class: "an-ft" }, h("i", { style: { width: Math.max(s.value ? 4 : 0, s.value / top * 100) + "%", background: s.color, animationDelay: i * 70 + "ms" } }, h("b", { text: s.value }))),
        h("small", { class: "an-fv", text: Apps.money(s.amount) }), h("small", { class: "an-fc", text: conv == null ? "" : conv + "%" }));
    }), d.note ? h("div", { class: "an-more", text: d.note }) : null));
  }
  function cellFmt(v, unit) {
    if (unit === "money" || unit === "hours" || unit === "pct" || unit === "days") return fmt(v, unit);
    if (unit === "date") return v ? fmtD(v) : "—";
    if (typeof v === "number") return fmt(v);
    return v == null || v === "" ? "—" : String(v);
  }
  function tableView(box, d, o) {
    const N = o.top || (o.size === "l" ? 15 : 8), rows = d.rows.slice(0, N), isNum = c => ["money", "hours", "pct", "days", "count"].includes(c.unit) || typeof d.rows[0]?.[d.cols.indexOf(c)] === "number";
    box.replaceChildren(h("div", { class: "an-tw" }, h("table", { class: "an-table" },
      h("thead", null, h("tr", null, ...d.cols.map(c => h("th", { class: isNum(c) ? "n" : "", text: c.label })))),
      h("tbody", null, ...rows.map((r, i) => h("tr", { style: { animationDelay: Math.min(i * 30, 400) + "ms" } }, ...r.map((v, j) => h("td", { class: isNum(d.cols[j]) ? "n" : "", text: cellFmt(v, d.cols[j].unit), title: typeof v === "string" ? v : "" })))))),
      d.rows.length > N ? h("div", { class: "an-more", text: `Top ${N} of ${d.rows.length} · download the CSV for all` }) : null));
  }
  function heatView(box, d) {
    let lo = 24, hi = -1;
    d.grid.forEach(r => r.forEach((v, hr) => { if (v) { lo = Math.min(lo, hr); hi = Math.max(hi, hr); } }));
    lo = Math.min(lo, 8); hi = Math.max(hi, 18);
    const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), max = Math.max(1, ...d.grid.flat());
    const hl = hr => time24() ? String(hr).padStart(2, "0") + ":00" : new Date(2024, 0, 1, hr).toLocaleTimeString([], { hour: "numeric" });
    box.replaceChildren(h("div", { class: "an-heat", style: { gridTemplateColumns: `38px repeat(${hours.length}, minmax(0, 1fr))` } },
      h("span"), ...hours.map((hr, i) => h("span", { class: "an-hh", text: i % 2 ? "" : hl(hr) })),
      ...d.grid.flatMap((row, di) => [h("span", { class: "an-hd", text: WDAYS[di] }), ...hours.map((hr, i) => {
        const v = row[hr], p = v ? Math.round(14 + 80 * v / max) : 0;
        return h("span", { class: "an-hc" + (v ? "" : " zero"), style: { background: v ? `color-mix(in srgb, var(--accent) ${p}%, transparent)` : "", animationDelay: (di * 30 + i * 8) + "ms" }, dataset: { tip: `${WDAYS[di]} ${hl(hr)}\n${fmt(v, d.unit)} · ${d.label.toLowerCase()}` } });
      })])),
      h("div", { class: "an-hleg" }, h("small", { text: "Less" }), ...[0, 25, 50, 75, 100].map(p => h("i", { style: { background: p ? `color-mix(in srgb, var(--accent) ${Math.round(14 + .8 * p)}%, transparent)` : "var(--hover)" } })), h("small", { text: "More" })));
  }
  function sparkline(W, vals) {
    const H = 34, n = vals.length, max = Math.max(...vals, 0) || 1, X = i => n <= 1 ? W / 2 : i * (W - 4) / (n - 1) + 2, Y = v => H - 3 - (v / max) * (H - 6);
    const line = vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(""), id = "ans" + (++gid);
    return `<svg class="an-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.25"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`
      + (n > 1 ? `<path class="an-area" d="${line}L${X(n - 1).toFixed(1)},${H}L${X(0).toFixed(1)},${H}Z" style="fill:url(#${id})"/><path class="an-line thin" pathLength="1" d="${line}" style="stroke:var(--accent)"/>` : "") + `</svg>`;
  }
  function countUp(el, to, unit) {
    if (!Number.isFinite(to) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now(), dur = 650;
    const step = t => { if (!el.isConnected) return; const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(unit === "pct" || unit === "money" || unit === "count" ? Math.round(to * e) : to * e, unit); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to, unit); };
    requestAnimationFrame(step);
  }
  function kpiView(box, d, o) {
    const ch = change(d.value, d.prev, d.invert, d.unit), val = h("div", { class: "an-kv", text: fmt(d.value, d.unit) });
    const wrap = h("div", { class: "an-kpi" }, val,
      ch ? h("div", { class: "an-kc " + (ch.flat ? "flat" : ch.good ? "good" : "bad"), title: "Previous period: " + fmt(d.prev, d.unit) }, h("b", { text: ch.text }), h("small", { text: "vs previous period" }))
        : h("div", { class: "an-kc flat" }, h("small", { text: d.sub || "" })));
    box.replaceChildren(wrap);
    if (d.spark && d.spark.some(Boolean)) wrap.insertAdjacentHTML("beforeend", sparkline(Math.max(80, box.clientWidth || 200), d.spark));
    if (o.anim) countUp(val, d.value, d.unit);
  }
  // draw a widget's data into its body
  function paint(body, w, d, anim) {
    body._w = body.clientWidth;
    const card = body.closest(".an-w"); card?.classList.toggle("anim", !!anim);
    const o = { size: w.size || "m", title: w.title, anim, top: w.options?.top };
    const ph = (ic, t) => body.replaceChildren(h("div", { class: "an-ph" }, h("span", { text: ic }), h("small", { text: t })));
    if (d.locked) return ph("🔒", `You don't have access to ${d.locked}.`);
    if (d.err) return ph("⚠️", d.err);
    if (d.shape !== "kpi" && isEmpty(d)) return ph("🌱", "No data for this period yet.");
    const type = w.type;
    if (d.shape === "kpi") return kpiView(body, d, o);
    if (d.shape === "series") return type === "bar" ? barChart(body, d, o) : lineChart(body, d, { ...o, area: type === "area" });
    if (d.shape === "funnel") return funnelView(body, d);
    if (d.shape === "heat") return heatView(body, d);
    if (d.shape === "table") return tableView(body, d, o);
    if (d.shape === "group") {
      const m = METRICS[w.metric] || {};
      if (type === "donut") return donut(body, d, o);
      if (type === "table") return tableView(body, { cols: [{ label: d.dim }, { label: m.label || "Value", unit: d.unit }], rows: d.items.map(x => [x.label, x.value]) }, o);
      if (type === "bar") { const its = d.items.slice(0, o.size === "l" ? 24 : 12); return barChart(body, { labels: its.map(x => x.label), unit: d.unit, series: [{ name: m.label, color: "var(--accent)", values: its.map(x => x.value) }] }, o); }
      return hbars(body, d, { ...o, avg: m.agg === "avg", colored: d.ordered && d.items.some(x => x.color) });
    }
    ph("🧩", "This chart can't show that data.");
  }

  /* ---------- CSV ---------- */
  function csvRows(w, d) {
    const m = METRICS[w.metric] || {}, name = w.title || m.label || "Value";
    switch (d.shape) {
      case "kpi": return [["Metric", "Value", ...(d.prev !== undefined ? ["Previous period"] : [])], [name, raw(d.value), ...(d.prev !== undefined ? [raw(d.prev)] : [])]];
      case "series": return [["Period", ...d.series.map(s => s.name)], ...d.labels.map((l, i) => [d.full?.[i] || l, ...d.series.map(s => raw(s.values[i]))])];
      case "group": return [[d.dim, m.label || name], ...d.items.map(x => [x.label, raw(x.value)])];
      case "table": return [d.cols.map(c => c.label), ...d.rows.map(r => r.map(raw))];
      case "funnel": return [["Stage", "Deals", "Amount", "Conversion from previous stage, %"], ...d.steps.map((s, i) => [s.label, s.value, raw(s.amount), i ? (d.steps[i - 1].value ? Math.round(s.value / d.steps[i - 1].value * 100) : 0) : ""])];
      case "heat": return [["Day", ...Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0") + ":00")], ...d.grid.map((r, i) => [WDAYS[i], ...r.map(raw)])];
    }
    return [];
  }
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function downloadCsv(w, d) {
    if (d.locked || d.err) return UI.toast("Nothing to download");
    const text = csvRows(w, d).map(r => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: (String(w.title || "widget").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "widget") + "-" + T() + ".csv" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ---------- ready dashboards ---------- */
  const W = (metric, type, groupBy, size, title, options) => ({ metric, type, groupBy: groupBy || "none", size: size || "m", title: title || "", options: options || {} });
  const READY = [
    { key: "sales", name: "Sales", icon: "💼", source: "crm", hint: "Add deals, leads or invoices in CRM and they show up here.", used: () => deals().length || leads().length || invoices().length,
      widgets: [W("deals_pipeline", "kpi", 0, "s"), W("deals_won", "kpi", 0, "s", "Won"), W("win_rate", "kpi", 0, "s"), W("leads_new", "kpi", 0, "s"),
        W("deals_won_count", "kpi", 0, "s"), W("avg_deal", "kpi", 0, "s"), W("inv_paid", "kpi", 0, "s"), W("inv_unpaid", "kpi", 0, "s"),
        W("deals_won", "area", "time", "m", "Revenue"), W("funnel", "funnel", 0, "m"),
        W("deals_won", "hbar", "person", "m", "Sales by person"), W("leads_new", "donut", "source", "m", "Lead sources"),
        W("inv_issued", "donut", "status", "m", "Invoices: paid, unpaid and overdue"), W("deals_pipeline", "bar", "stage", "m", "Pipeline by stage"),
        W("deals_pipeline", "table", 0, "l", "Top open deals")] },
    { key: "tasks", name: "Tasks", icon: "✅", source: "tasks", period: "week", hint: "Create tasks and finish them to see trends here.", used: () => tasks().length,
      widgets: [W("tasks_open", "kpi", 0, "s"), W("tasks_overdue", "kpi", 0, "s"), W("tasks_done", "kpi", 0, "s", "Done"), W("tasks_ontime", "kpi", 0, "s"),
        W("tasks_done", "line", "time", "m", "Completion trend", { extra: ["tasks_created"] }), W("tasks_open", "hbar", "person", "m", "Workload by person"),
        W("tasks_open", "donut", "project", "m", "Open tasks by project"), W("time_tracked", "hbar", "person", "m", "Time tracked by person"),
        W("tasks_done", "heat", "dayhour", "l", "When tasks get done"), W("tasks_overdue", "table", 0, "l", "Overdue tasks")] },
    { key: "team", name: "Team", icon: "🏢", source: "team", hint: "Clock in, request time off or send work reports in Company & HR.", used: () => Data.list("timelog").length || Data.list("absences").length || Data.list("reports").length,
      widgets: [W("headcount", "kpi", 0, "s"), W("present_today", "kpi", 0, "s"), W("out_today", "kpi", 0, "s"), W("hours_worked", "kpi", 0, "s"),
        W("late", "kpi", 0, "s"), W("absence_days", "kpi", 0, "s"), W("reports_sent", "kpi", 0, "s"), W("reports_approved", "kpi", 0, "s"),
        W("headcount", "donut", "dept", "m", "Headcount by department"), W("hours_worked", "hbar", "person", "m", "Hours worked by person"),
        W("late", "bar", "person", "m", "Late arrivals by person"), W("absence_days", "donut", "type", "m", "Absence days by type"),
        W("hours_worked", "area", "time", "m", "Hours worked over time"), W("reports_sent", "donut", "status", "m", "Work reports")] },
    { key: "booking", name: "Booking", icon: "🗓️", source: "booking", hint: "Take bookings in the Booking app to see them here.", used: () => bookings().length,
      widgets: [W("bookings", "kpi", 0, "s"), W("bk_revenue", "kpi", 0, "s", "Revenue"), W("noshows", "kpi", 0, "s"), W("utilisation", "kpi", 0, "s"),
        W("bookings", "bar", "time", "m", "Bookings per day"), W("utilisation", "hbar", "resource", "m", "Utilisation per resource"),
        W("bk_revenue", "area", "time", "m", "Revenue over time"), W("bookings", "donut", "service", "m", "Bookings by service"),
        W("bookings", "heat", "dayhour", "l", "Busy hours")] },
    { key: "inventory", name: "Inventory", icon: "📦", source: "inventory", hint: "Track stock in the Inventory app to see it here.", used: () => invDocs().length || products().some(p => p.track),
      widgets: [W("stock_value", "kpi", 0, "s"), W("low_stock", "kpi", 0, "s"), W("inv_moves", "kpi", 0, "s"), W("inv_units", "kpi", 0, "s"),
        W("low_stock", "table", 0, "m", "Low stock"), W("stock_value", "donut", "category", "m", "Stock value by category"),
        W("inv_moves", "bar", "type", "m", "Movements by type"), W("inv_units", "line", "time", "m", "Units moved over time"),
        W("stock_value", "table", 0, "l", "Most valuable stock")] },
    { key: "automation", name: "Automation", icon: "⚡", source: "automation", hint: "Start approvals or turn on automation rules to see them here.", used: () => Data.list("wfruns").length || Data.list("rules").some(r => r.trigger),
      widgets: [W("approvals_open", "kpi", 0, "s"), W("approvals_approved", "kpi", 0, "s"), W("approvals_declined", "kpi", 0, "s"), W("decision_time", "kpi", 0, "s"),
        W("approvals", "donut", "status", "m", "Requests by result"), W("approvals", "hbar", "workflow", "m", "Requests by process"),
        W("rule_runs", "bar", "time", "m", "Rule runs"), W("rule_runs", "hbar", "rule", "m", "Runs by rule"),
        W("decision_time", "bar", "workflow", "m", "Decision time by process"), W("approvals_open", "table", 0, "m", "Waiting for a decision")] },
  ];
  READY.forEach(r => r.widgets.forEach((w, i) => { w.id = r.key + "-" + i; w.source = METRICS[w.metric].source; }));
  const readyList = () => READY.filter(r => canView(SRC[r.source].app));
  const ownerOf = d => d.owner || d.by;
  const customs = () => Data.list("dashboards").filter(d => d && !d.deleted && (d.shared || ownerOf(d) === me())).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const canEditDash = d => !!d && canCreate() && (ownerOf(d) === me() || (d.shared && isAdmin() && !!window.Cloud?.ws));
  const autoTitle = (m, g) => m ? m.label + (g && g !== "none" && g !== "time" && g !== "dayhour" ? " by " + (DIMS[g] || g).toLowerCase() : "") : "Widget";

  async function newDash(open, widgets) {
    if (!canCreate()) return UI.toast("You can't create dashboards here. Ask an admin.");
    const v = await Apps.form("New dashboard", [{ key: "name", label: "Name", required: true, placeholder: "e.g. Weekly sales review" }, { key: "shared", label: "Share with everyone in the workspace", type: "checkbox" }], { shared: false }, { ok: "Create dashboard" });
    if (!v) return null;
    const id = await Data.add("dashboards", { name: String(v.name).trim(), icon: "📊", widgets: (widgets || []).map(w => ({ ...w, id: Data.uid() })), shared: !!v.shared, owner: me() });
    UI.toast("📊 Dashboard created");
    open && open("c:" + id);
    return id;
  }

  /* ---------- widget gallery (add / edit) ---------- */
  function gallery(dash, existing, ctxBase) {
    const srcs = Object.entries(SRC).filter(([, s]) => canView(s.app)).map(([k]) => k);
    if (!srcs.length) return UI.toast("You don't have access to any data sources.");
    const first = srcs[0], firstM = id => Object.values(METRICS).find(m => m.source === id)?.id;
    const w = existing ? JSON.parse(JSON.stringify(existing)) : { id: Data.uid(), source: first, metric: firstM(first), groupBy: "none", type: "kpi", size: "s", title: "", period: "", options: {} };
    if (!METRICS[w.metric] || !srcs.includes(METRICS[w.metric].source)) { w.source = first; w.metric = firstM(first); }
    w.options = w.options && typeof w.options === "object" ? w.options : {};
    let sizeTouched = !!existing;
    const ctrl = h("div", { class: "an-gc" }), prevBox = h("div", { class: "an-gp" });
    const titleIn = h("input", { class: "menu-input", placeholder: autoTitle(METRICS[w.metric], w.groupBy), maxlength: 80 }); titleIn.value = w.title || "";
    titleIn.oninput = () => { w.title = titleIn.value; preview(); };
    const fix = () => {
      const m = METRICS[w.metric], gs = groupsOf(m);
      if (!gs.includes(w.groupBy)) w.groupBy = gs[0];
      const cs = chartsFor(m, w.groupBy);
      if (!cs.includes(w.type)) w.type = cs[0];
      if (!sizeTouched) w.size = w.type === "kpi" ? "s" : w.type === "heat" || (w.type === "table" && w.groupBy === "none") ? "l" : "m";
      w.source = m.source;
      if (w.options?.extra) w.options.extra = w.options.extra.filter(x => x !== w.metric && METRICS[x]?.source === m.source);
    };
    const row = (label, el) => h("div", { class: "an-gr" }, h("div", { class: "an-glab", text: label }), el);
    function draw() {
      fix();
      const m = METRICS[w.metric];
      const sibs = Object.values(METRICS).filter(x => x.id !== m.id && x.source === m.source && !x.snapshot && !x.custom && x.unit === m.unit);
      ctrl.replaceChildren(
        row("Data source", h("div", { class: "an-chips" }, ...srcs.map(k => h("button", { type: "button", class: "chip-btn" + (m.source === k ? " on" : ""), onclick: () => { w.metric = firstM(k); draw(); } }, SRC[k].icon + " " + SRC[k].label)))),
        row("Metric", h("div", { class: "an-mets" }, ...Object.values(METRICS).filter(x => x.source === m.source).map(x => h("button", { type: "button", class: "an-met" + (x.id === w.metric ? " on" : ""), onclick: () => { w.metric = x.id; draw(); } },
          h("b", { text: x.label }), h("small", { text: x.desc || "" }))))),
        row("Group by", h("div", { class: "seg an-seg" }, ...groupsOf(m).map(g => h("button", { type: "button", class: w.groupBy === g ? "on" : "", text: DIMS[g] || g, onclick: () => { w.groupBy = g; draw(); } })))),
        row("Chart", h("div", { class: "seg an-seg" }, ...chartsFor(m, w.groupBy).map(c => h("button", { type: "button", class: w.type === c ? "on" : "", text: CHARTS[c][1] + " " + CHARTS[c][0], onclick: () => { w.type = c; draw(); } })))),
        w.groupBy === "time" && sibs.length ? row("Compare with", h("div", { class: "an-chips" }, ...sibs.map(x => { const on = (w.options.extra || []).includes(x.id); return h("button", { type: "button", class: "chip-btn" + (on ? " on" : ""), onclick: () => { const e = new Set(w.options.extra || []); on ? e.delete(x.id) : e.add(x.id); w.options.extra = [...e].slice(0, 3); draw(); } }, (on ? "✓ " : "+ ") + x.label); }))) : null,
        row("Title", titleIn),
        h("div", { class: "an-g2" },
          row("Size", h("div", { class: "seg an-seg" }, ...[["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([k, l]) => h("button", { type: "button", class: w.size === k ? "on" : "", text: l, onclick: () => { w.size = k; sizeTouched = true; draw(); } })))),
          m.snapshot ? null : row("Period", h("select", { class: "menu-input", onchange: e => { w.period = e.target.value; preview(); } },
            h("option", { value: "", selected: !w.period }, "Dashboard filter"), ...PERIODS.filter(p => p[0] !== "custom").map(([k, l]) => h("option", { value: k, selected: w.period === k }, l))))));
      titleIn.placeholder = autoTitle(m, w.groupBy);
      preview();
    }
    function preview() {
      resetCache();
      const ww = { ...w, title: w.title || autoTitle(METRICS[w.metric], w.groupBy) };
      const c = widgetCard(ww, { ctx: ctxFor(ctxBase, ww), anim: true, preview: true });
      c.classList.add("an-size-" + ww.size);
      prevBox.replaceChildren(h("div", { class: "an-glab", text: "Preview" }), c);
      const b = c.querySelector(".an-wb"); paint(b, ww, c._data, true);
    }
    const save = h("button", { class: "btn primary", text: existing ? "Save widget" : "Add widget" });
    const m0 = UI.modal(existing ? "Edit widget" : "Add a widget", h("div", { class: "an-gal" }, ctrl, prevBox,
      h("div", { class: "f-actions an-gacts" }, h("span"), h("span", { class: "an-row" }, h("button", { class: "btn", text: "Cancel", onclick: () => m0.close() }), save))), { className: "an-gmodal", onClose: hideTip });
    tipEvents(m0.el);
    save.onclick = async () => {
      const cur = Data.get("dashboards", dash.id); if (!cur) { m0.close(); return; }
      const out = { id: w.id, type: w.type, title: (w.title || "").trim() || autoTitle(METRICS[w.metric], w.groupBy), source: w.source, metric: w.metric, groupBy: w.groupBy, period: w.period || "", size: w.size, options: w.options || {} };
      const list = cur.widgets || [];
      await Data.update("dashboards", dash.id, { widgets: existing ? list.map(x => x.id === w.id ? out : x) : [...list, out] });
      m0.close(); UI.toast(existing ? "Widget saved" : "📊 Widget added");
    };
    draw();
  }

  // filter context for a widget (a widget may have its own period)
  function ctxFor(f, w) { const r = range(w && w.period ? { period: w.period } : (f || { period: "month" })); return { ...r, person: f?.person || "", pipeline: f?.pipeline || "" }; }

  // widget card (header + body); data is computed here, painted after the card is in the page
  function widgetCard(w, o) {
    const m = METRICS[w.metric], d = safeCompute(w, o.ctx);
    const sub = d.locked || d.err ? "" : w.period ? periodName(w.period) : d.shape === "series" ? "by " + d.gran : m?.snapshot ? "right now" : "";
    const menuBtn = o.preview ? null : h("button", { class: "icon-btn xs an-wm", title: "Widget options", "aria-label": "Widget options", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); o.onMenu?.(e.currentTarget, w, d); } });
    const c = h("section", { class: `an-w glass an-size-${w.size || "m"} an-t-${w.type}`, dataset: { id: w.id } },
      h("header", { class: "an-wh" }, o.editable ? h("span", { class: "an-grip", title: "Drag to move", html: UI.icon("drag") }) : null,
        h("div", { class: "an-wtt" }, h("span", { class: "an-wt tt", text: w.title || autoTitle(m, w.groupBy) }), sub ? h("small", { class: "an-ws", text: sub }) : null), menuBtn),
      h("div", { class: "an-wb" }));
    c._data = d;
    return c;
  }

  /* ---------- app ---------- */
  function render(root, arg) {
    let key = arg || store.get("last", "sales");
    let offs = [], timer = 0, armed = false, dragId = null, downHead = false, pending = false;
    const ro = new ResizeObserver(entries => entries.forEach(en => { const b = en.target; if (b._repaint && Math.abs(en.contentRect.width - (b._w || 0)) > 4) b._repaint(); }));
    const side = h("nav", { class: "an-side glass", "aria-label": "Dashboards" }), main = h("div", { class: "an-main" });
    const newBtn = canCreate() ? h("button", { class: "btn primary", text: "+ New dashboard", onclick: () => newDash(open) }) : null;
    root.append(Apps.header("Analytics", "📊", "Dashboards and reports across your workspace", newBtn), h("div", { class: "an-layout" }, side, main));
    tipEvents(root);

    const resolve = k => {
      if (String(k).startsWith("c:")) { const d = Data.get("dashboards", k.slice(2)); if (d && !d.deleted && (d.shared || ownerOf(d) === me())) return { custom: true, key: k, doc: d, name: d.name || "Untitled dashboard", icon: d.icon || "📊", widgets: d.widgets || [] }; return null; }
      const r = readyList().find(x => x.key === k);
      return r ? { custom: false, key: k, ready: r, name: r.name, icon: r.icon, widgets: r.widgets } : null;
    };
    const current = () => resolve(key) || resolve(readyList()[0]?.key) || (customs()[0] ? resolve("c:" + customs()[0].id) : null);
    const filt = D => ({ period: D?.ready?.period || "month", person: "", pipeline: "", from: "", to: "", ...store.get("f:" + D?.key, {}) });
    const setF = (D, patch) => { store.set("f:" + D.key, { ...filt(D), ...patch }); drawAll(true); };
    const usesCrm = D => D.widgets.some(w => METRICS[w.metric]?.source === "crm");

    function open(k) {
      key = k; store.set("last", k);
      try { history.replaceState(null, "", "#/app/analytics/" + encodeURIComponent(k)); } catch {}
      watch(); drawAll(true);
      document.getElementById("scroller")?.scrollTo({ top: 0 });
    }
    // live: only the collections the open dashboard needs (+ dashboards)
    let watched = "";
    const colsFor = D => { const cols = new Set(["dashboards"]); (D?.widgets || []).forEach(w => { const m = METRICS[w.metric]; if (m) SRC[m.source].cols.forEach(c => cols.add(c)); }); return [...cols].sort(); };
    function watch() {
      offs.forEach(f => f()); armed = false;
      const cols = colsFor(current());
      watched = cols.join(",");
      offs = cols.map(c => Data.on(c, schedule));
      armed = true;
    }
    const redraw = UI.liveDraw(root, () => drawAll(false));
    function schedule() {
      if (!armed) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (dragId) { pending = true; return; } redraw(); }, 500);
    }

    function drawSide(D) {
      const mine = customs();
      side.replaceChildren(
        h("div", { class: "an-sec", text: "Ready dashboards" }),
        ...readyList().map(r => { let used = true; try { used = !!r.used(); } catch {} return h("button", { class: "an-di" + (D?.key === r.key ? " on" : "") + (used ? "" : " unused"), onclick: () => open(r.key), title: used ? r.name : r.name + " · not used yet" },
          h("span", { class: "an-dic", text: r.icon }), h("span", { class: "an-din", text: r.name }), used ? null : h("small", { class: "an-nu", text: "Not used yet" })); }),
        h("div", { class: "an-sec" }, h("span", { text: "Custom dashboards" }), canCreate() ? h("button", { class: "icon-btn xs", title: "New dashboard", "aria-label": "New dashboard", html: UI.icon("plus"), onclick: () => newDash(open) }) : null),
        ...(mine.length ? mine.map(d => h("button", { class: "an-di" + (D?.key === "c:" + d.id ? " on" : ""), onclick: () => open("c:" + d.id) },
          h("span", { class: "an-dic", text: d.icon || "📊" }), h("span", { class: "an-din", text: d.name || "Untitled dashboard" }),
          d.shared ? h("small", { class: "an-sh", title: ownerOf(d) === me() ? "Shared with the workspace" : "Shared by " + pname(ownerOf(d)), text: "👥" }) : h("small", { class: "an-sh", title: "Private", text: "🔒" })))
          : [h("div", { class: "an-hint", text: canCreate() ? "Build your own from a gallery of metrics." : "No custom dashboards yet." })]));
    }

    function filterBar(D, f) {
      const r = range(f);
      const sel = h("select", { class: "app-select", "aria-label": "Period", onchange: e => setF(D, { period: e.target.value }) }, ...PERIODS.map(([k, l]) => h("option", { value: k, selected: f.period === k }, l)));
      const dates = f.period === "custom" ? [h("input", { type: "date", class: "app-select an-date", value: r.from, "aria-label": "From", onchange: e => setF(D, { from: e.target.value }) }), h("span", { class: "an-to", text: "–" }),
        h("input", { type: "date", class: "app-select an-date", value: r.to, "aria-label": "To", onchange: e => setF(D, { to: e.target.value }) })] : [];
      const who = f.person ? Data.person(f.person) : null;
      const pb = h("button", { class: "chip-btn an-pp" + (who ? " on" : ""), onclick: e => Apps.personPicker(e.currentTarget, p => setF(D, { person: p ? p.key : "" }), { allowNone: false }) },
        who ? Apps.avatar(who, 20) : h("span", { text: "👥" }), h("span", { text: who ? who.name : "Everyone" }));
      const clear = who ? h("button", { class: "icon-btn xs", title: "Show everyone", "aria-label": "Show everyone", html: UI.icon("x"), onclick: () => setF(D, { person: "" }) }) : null;
      const ps = pipes();
      const pipe = usesCrm(D) && ps.length > 1 ? h("select", { class: "app-select", "aria-label": "Pipeline", onchange: e => setF(D, { pipeline: e.target.value }) },
        h("option", { value: "", selected: !f.pipeline }, "All pipelines"), ...ps.map(p => h("option", { value: p.id, selected: f.pipeline === p.id }, p.name || "Pipeline"))) : null;
      return h("div", { class: "an-filters" }, sel, ...dates, h("span", { class: "an-pwrap" }, pb, clear), pipe, h("span", { class: "grow" }),
        h("small", { class: "an-range", text: `${fmtD(r.from)} – ${fmtD(r.to)} · compared with ${fmtD(r.pf)} – ${fmtD(r.pt)}` }));
    }

    function widgetMenu(D, anchor, w, d) {
      const doc = D.custom ? D.doc : null, editable = D.custom && canEditDash(doc), ws = doc?.widgets || [], i = ws.findIndex(x => x.id === w.id);
      const save = list => Data.update("dashboards", doc.id, { widgets: list });
      const targets = customs().filter(x => canEditDash(x) && x.id !== doc?.id);
      UI.menu(anchor, [
        { label: "Download CSV", icon: "download", onClick: () => downloadCsv(w, d) },
        editable ? { label: "Edit widget", iconHtml: "✏️", onClick: () => gallery(doc, w, filt(D)) } : null,
        editable ? { sep: true } : null,
        ...(editable ? [["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([k, l]) => ({ label: l + ((w.size || "m") === k ? "  ✓" : ""), iconHtml: k === "s" ? "▫️" : k === "m" ? "◻️" : "⬜", onClick: () => save(ws.map(x => x.id === w.id ? { ...x, size: k } : x)) })) : []),
        editable && i > 0 ? { label: "Move earlier", iconHtml: "←", onClick: () => { const l = [...ws]; l.splice(i - 1, 0, l.splice(i, 1)[0]); save(l); } } : null,
        editable && i < ws.length - 1 ? { label: "Move later", iconHtml: "→", onClick: () => { const l = [...ws]; l.splice(i + 1, 0, l.splice(i, 1)[0]); save(l); } } : null,
        canCreate() ? { sep: true } : null,
        canCreate() ? { label: "Copy to a dashboard…", icon: "copy", onClick: () => UI.menu(anchor, [
          ...targets.map(t => ({ label: (t.icon || "📊") + " " + (t.name || "Untitled"), onClick: async () => { await Data.update("dashboards", t.id, { widgets: [...(t.widgets || []), { ...w, id: Data.uid() }] }); UI.toast("Copied to “" + (t.name || "dashboard") + "”"); } })),
          { label: "New dashboard…", icon: "plus", onClick: () => newDash(open, [w]) }]) } : null,
        editable ? { sep: true } : null,
        editable ? { label: "Remove widget", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm("Remove this widget from the dashboard?", "Remove")) save(ws.filter(x => x.id !== w.id)); } } : null,
      ], { align: "end" });
    }

    function dashMenu(D, anchor) {
      const d = D.doc;
      UI.menu(anchor, [
        { label: "Rename", iconHtml: "✏️", onClick: async () => { const v = await Apps.form("Rename dashboard", [{ key: "name", label: "Name", required: true }], { name: d.name || "" }); if (v) Data.update("dashboards", d.id, { name: String(v.name).trim() }); } },
        { label: "Change icon", iconHtml: d.icon || "📊", onClick: () => UI.emojiPicker(anchor, e => Data.update("dashboards", d.id, { icon: e || "📊" })) },
        ownerOf(d) === me() ? { label: "Share with the workspace", toggle: !!d.shared, onClick: () => { const cur = Data.get("dashboards", d.id); Data.update("dashboards", d.id, { shared: !cur?.shared }); UI.toast(cur?.shared ? "🔒 Only you can see it now" : "👥 Everyone in the workspace can see it now"); } } : null,
        { label: "Print", iconHtml: "🖨️", onClick: () => window.print() },
        { sep: true },
        { label: "Delete dashboard", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete “${d.name || "this dashboard"}”${d.shared ? " for everyone" : ""}?`)) { await Data.remove("dashboards", d.id); UI.toast("Dashboard deleted"); open(readyList()[0]?.key || ""); } } },
      ], { align: "end" });
    }

    function drawAll(anim) {
      resetCache(); hideTip();
      clearTimeout(timer); pending = false;
      const D = current();
      drawSide(D);
      ro.disconnect();
      if (!D) { main.replaceChildren(Apps.empty("📊", "No dashboards you can open yet.", newBtn ? h("button", { class: "btn primary", text: "+ New dashboard", onclick: () => newDash(open) }) : null)); return; }
      if (D.key !== key) { key = D.key; }
      if (colsFor(D).join(",") !== watched) watch(); // a widget from another source was added
      const f = filt(D), r = range(f), editable = D.custom && canEditDash(D.doc);
      const sub = D.custom ? (D.doc.shared ? (ownerOf(D.doc) === me() ? "Shared with the workspace" : "Shared by " + pname(ownerOf(D.doc))) : "Private · only you see it") : "Ready dashboard";
      const acts = h("div", { class: "an-acts" },
        editable ? h("button", { class: "btn primary", text: "+ Add widget", onclick: () => gallery(D.doc, null, f) }) : null,
        !D.custom && canCreate() ? h("button", { class: "btn", text: "Copy to my dashboards", title: "Make an editable copy", onclick: () => newDash(open, D.widgets) }) : null,
        D.custom && !editable && canCreate() ? h("button", { class: "btn", text: "Make a copy", onclick: () => newDash(open, D.widgets) }) : null,
        h("button", { class: "btn", text: "🖨️ Print", onclick: () => window.print() }),
        editable ? h("button", { class: "icon-btn", title: "Dashboard options", "aria-label": "Dashboard options", html: UI.icon("dots"), onclick: e => dashMenu(D, e.currentTarget) }) : null);
      const head = h("div", { class: "an-dh" }, h("span", { class: "an-dhi", text: D.icon }), h("div", { class: "an-dht" }, h("h2", { text: D.name }), h("small", { text: sub })), acts);
      const printHead = h("div", { class: "an-print" }, `${D.name} · ${fmtD(r.from)} – ${fmtD(r.to)}${f.person ? " · " + pname(f.person) : ""} · printed ${Apps.fmtDateTime?.(Date.now()) ?? new Date().toLocaleString()}`);
      let used = true; if (!D.custom) { try { used = !!D.ready.used(); } catch {} }
      if (!used) {
        const app = SRC[D.ready.source].app;
        main.replaceChildren(head, Apps.empty(D.icon, `Not used yet. ${D.ready.hint}`, Apps.reg?.[app] ? h("button", { class: "btn primary", text: "Open " + (Apps.reg[app].title || D.name), onclick: () => Apps.go(app) }) : null));
        return;
      }
      const grid = h("div", { class: "an-grid" + (editable ? " editable" : "") });
      const cards = D.widgets.map((w, i) => {
        const c = widgetCard(w, { ctx: ctxFor(f, w), editable, onMenu: (a, ww, d) => widgetMenu(D, a, ww, d) });
        if (anim) c.style.animationDelay = Math.min(i * 35, 420) + "ms";
        if (editable) dnd(c, w, D);
        grid.append(c); return [c, w];
      });
      main.replaceChildren(head, printHead, filterBar(D, f), D.widgets.length ? grid
        : Apps.empty("🧩", editable ? "This dashboard is empty. Add widgets from the gallery." : "This dashboard has no widgets yet.", editable ? h("button", { class: "btn primary", text: "+ Add widget", onclick: () => gallery(D.doc, null, f) }) : null));
      cards.forEach(([c, w]) => {
        const b = c.querySelector(".an-wb");
        paint(b, w, c._data, anim);
        b._repaint = () => paint(b, w, c._data, false);
        ro.observe(b);
      });
    }

    // drag a widget by its header to reorder
    function dnd(c, w, D) {
      c.draggable = true;
      c.addEventListener("pointerdown", e => { downHead = !!e.target.closest(".an-wh") && !e.target.closest("button"); });
      c.addEventListener("dragstart", e => {
        if (!downHead) { e.preventDefault(); return; }
        dragId = w.id; e.dataTransfer.setData("text/plain", "an-w:" + w.id); e.dataTransfer.effectAllowed = "move";
        setTimeout(() => c.classList.add("dragging"));
      });
      c.addEventListener("dragend", () => {
        dragId = null; c.classList.remove("dragging");
        root.querySelectorAll(".drop-before, .drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
        if (pending) { pending = false; schedule(); }
      });
      c.addEventListener("dragover", e => {
        if (!dragId || dragId === w.id) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        c.classList.toggle("drop-after", after); c.classList.toggle("drop-before", !after);
      });
      c.addEventListener("dragleave", e => { if (!c.contains(e.relatedTarget)) c.classList.remove("drop-before", "drop-after"); });
      c.addEventListener("drop", e => {
        e.preventDefault();
        const after = c.classList.contains("drop-after"), from = dragId;
        c.classList.remove("drop-before", "drop-after");
        if (!from || from === w.id) return;
        const doc = Data.get("dashboards", D.doc.id); if (!doc) return;
        const list = [...(doc.widgets || [])], moving = list.find(x => x.id === from); if (!moving) return;
        const rest = list.filter(x => x.id !== from), at = rest.findIndex(x => x.id === w.id);
        rest.splice(after ? at + 1 : at, 0, moving);
        dragId = null;
        Data.update("dashboards", doc.id, { widgets: rest });
      });
    }

    const onWs = () => { watch(); drawAll(true); };
    Apps.onWorkspace.add(onWs);
    const onAccess = () => { watch(); drawAll(false); };
    Apps.onAccess?.add?.(onAccess);
    watch();
    drawAll(true);
    return () => {
      offs.forEach(f => f()); clearTimeout(timer); ro.disconnect(); hideTip();
      Apps.onWorkspace.delete(onWs); Apps.onAccess?.delete?.(onAccess);
      tipEl?.remove(); tipEl = null;
    };
  }

  Apps.register("analytics", { title: "Analytics", icon: "📊", render });
  Apps.Analytics = { metrics: () => Object.values(METRICS).map(m => ({ id: m.id, source: m.source, label: m.label, unit: m.unit })), compute: (w, f) => { resetCache(); return safeCompute(w, ctxFor(f || { period: "month" }, w)); } };
})();
