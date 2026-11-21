/* CRM (Bitrix24-style): pipelines and stages, deals (kanban, list, activities, calendar), leads with conversion, contacts, companies,
   planned activities, history, recycle bin, duplicates, CSV import/export, custom fields, smart processes, analytics.
   Products, estimates and invoices come from Apps.Sales (js/apps/sales.js); web forms from Apps.Forms (js/apps/forms.js). */
(function () {
  const { h, esc } = UI;

  /* ---------- constants ---------- */
  const STAGES0 = [["new", "New", "gray"], ["qualified", "Qualified", "blue"], ["proposal", "Proposal", "purple"], ["negotiation", "Negotiation", "orange"], ["won", "Won", "green"], ["lost", "Lost", "red"]];
  const LEAD_ST = [["new", "New", "blue"], ["contacted", "Contacted", "purple"], ["qualified", "Qualified", "green"], ["junk", "Junk", "gray"], ["converted", "Converted", "green"]];
  const SOURCES = ["Website", "Web form", "Referral", "Social media", "Ads", "Cold call", "Event", "Other"];
  const COLORS = ["gray", "blue", "purple", "pink", "orange", "yellow", "green", "brown", "red"];
  const CTYPES = [["client", "Client"], ["vendor", "Vendor"], ["partner", "Partner"]];
  const ATYPES = { note: ["💬", "Comment"], call: ["📞", "Call"], meeting: ["🤝", "Meeting"], task: ["✅", "Task"], email: ["✉️", "Email"] };
  const OLD_ACT = { call: ["📞", "Call"], meeting: ["🤝", "Meeting"], email: ["✉️", "Email"], note: ["📝", "Note"] };
  const SEMS = [["process", "In progress"], ["won", "Won"], ["lost", "Lost"]];
  const WON_R = ["Best price", "Great relationship", "Product fit", "Fast response"];
  const LOST_R = ["Too expensive", "Chose a competitor", "No budget", "No response", "Bad timing"];
  const ENT = ["deals", "leads", "contacts", "companies"];
  const HIST_COLS = [...ENT, "items"];
  const LABEL = { deals: "deal", leads: "lead", contacts: "contact", companies: "company", items: "item" };
  const PLURAL = { deals: "deals", leads: "leads", contacts: "contacts", companies: "companies", items: "items" };
  const ICON = { deals: "💼", leads: "🧲", contacts: "👤", companies: "🏢", items: "🧩" };
  const DAY = 86400000;

  const me = () => Data.me().key;
  const uid = () => Math.random().toString(36).slice(2, 8);
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
  const digits = s => String(s || "").replace(/\D/g, "");
  const low = s => String(s || "").trim().toLowerCase();
  const ls = {
    get(k, d) { try { return localStorage.getItem("lumen-crm-" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lumen-crm-" + k, v); } catch {} },
  };
  const tagEl = (text, color) => h("span", { class: "tag", dataset: { tc: color || "gray" }, text });
  const leadTag = k => { const s = LEAD_ST.find(x => x[0] === k) || LEAD_ST[0]; return tagEl(s[1], s[2]); };
  const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /* ---------- settings: pipelines, custom fields, smart processes ---------- */
  const cfg = () => Data.get("settings", "crm") || {};
  const saveCfg = patch => Data.update("settings", "crm", patch);
  const defPipe = () => ({ id: "default", name: "Default pipeline", stages: STAGES0.map(([id, name, color]) => ({ id, name, color, sem: id === "won" ? "won" : id === "lost" ? "lost" : "process" })) });
  function pipelines() { const p = cfg().pipelines; return Array.isArray(p) && p.length ? p : [defPipe()]; }
  function pipeline(pid) { const ps = pipelines(); return ps.find(p => p.id === (pid || "default")) || ps[0]; }
  function stagesFor(pid) { return (pipeline(pid) || defPipe()).stages || []; }
  const smartTypes = () => (cfg().smart || []).filter(t => t && t.id);
  const smartType = id => smartTypes().find(t => t.id === id);
  const fieldsFor = col => ((cfg().fields || {})[col] || []).filter(f => f && f.key);
  const customFields = (col, r) => col === "items" ? (smartType(r?.type)?.fields || []) : fieldsFor(col);
  const stagesOf = (col, r) => col === "items" ? (smartType(r?.type)?.stages || []) : stagesFor(r?.pipeline);
  function stageOf(col, r) {
    const ss = stagesOf(col, r);
    return ss.find(s => s.id === r.stage) || ss[0] || { id: r.stage || "", name: r.stage || "—", color: "gray", sem: "process" };
  }
  const dStage = d => stageOf("deals", d);
  const isOpenDeal = d => dStage(d).sem === "process";
  const pipeOf = d => pipeline(d.pipeline).id;

  /* ---------- records ---------- */
  const live = col => Data.list(col).filter(r => r && !r.deleted);
  const recName = r => r ? (r.title || r.name || "Untitled") : "";
  const name = (col, id) => { const r = id && Data.get(col, id); return r && !r.deleted ? (r.name || r.title || "") : ""; };
  const recLive = ent => { const r = ent && Data.get(ent.col, ent.id); return !!r && !r.deleted; };
  const amt = r => +(r?.amount) || 0;
  const sum = rows => rows.reduce((a, r) => a + amt(r), 0);
  const typeLabel = col => col === "items" ? "item" : LABEL[col];
  const recLabel = (col, r) => col === "items" ? (smartType(r?.type)?.name || "Item") : cap(LABEL[col]);
  const personOut = k => { if (!k) return ""; const p = Data.person(k); return p.email || p.name || ""; };

  /* ---------- form fields ---------- */
  const refOpts = col => [["", "—"], ...live(col).sort((a, b) => recName(a).localeCompare(recName(b))).map(c => [c.id, recName(c)])];
  function stageOptions() {
    const ps = pipelines(), many = ps.length > 1;
    return ps.flatMap(p => (p.stages || []).map(s => [p.id + "::" + s.id, many ? p.name + " · " + s.name : s.name]));
  }
  const FIELDS = {
    deals: () => [{ key: "title", label: "Deal name", required: true }, { key: "amount", label: "Amount", type: "number", half: true }, { key: "_stage", label: "Stage", type: "select", options: stageOptions(), half: true },
      { key: "contact", label: "Contact", type: "select", options: refOpts("contacts"), half: true }, { key: "company", label: "Company", type: "select", options: refOpts("companies"), half: true },
      { key: "owner", label: "Responsible", type: "person", half: true }, { key: "close", label: "Expected close", type: "date", half: true }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    leads: () => [{ key: "name", label: "Lead name", required: true, placeholder: "Person or opportunity" }, { key: "companyName", label: "Company", half: true }, { key: "source", label: "Source", type: "select", options: SOURCES, half: true },
      { key: "email", label: "Email", type: "email", half: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "status", label: "Status", type: "select", options: LEAD_ST.map(s => [s[0], s[1]]), half: true },
      { key: "owner", label: "Responsible", type: "person", half: true }, { key: "value", label: "Potential value", type: "number" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    contacts: () => [{ key: "name", label: "Full name", required: true }, { key: "position", label: "Position", half: true }, { key: "company", label: "Company", type: "select", options: refOpts("companies"), half: true },
      { key: "email", label: "Email", type: "email", half: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "owner", label: "Responsible", type: "person" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    companies: () => [{ key: "name", label: "Company name", required: true }, { key: "type", label: "Type", type: "select", options: CTYPES, half: true }, { key: "industry", label: "Industry", half: true },
      { key: "size", label: "Employees", type: "select", options: ["", "1-10", "11-50", "51-200", "201-1000", "1000+"], half: true }, { key: "website", label: "Website", half: true },
      { key: "phone", label: "Phone", type: "tel", half: true }, { key: "email", label: "Email", type: "email", half: true }, { key: "owner", label: "Responsible", type: "person" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    items: t => [{ key: "title", label: "Title", required: true }, { key: "stage", label: "Stage", type: "select", options: (t?.stages || []).map(s => [s.id, s.name]), half: true },
      { key: "amount", label: "Amount", type: "number", half: true }, { key: "owner", label: "Responsible", type: "person" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
  };
  const EXTRA_LABELS = { pipeline: "Pipeline", stage: "Stage", closeReason: "Close reason", products: "Products", type: "Type", deal: "Deal", status: "Status", title: "Title", name: "Name" };
  function labelOf(col, key, r) {
    if (key.startsWith("cf:")) { const f = customFields(col, r).find(x => x.key === key.slice(3)); return f ? f.label : key.slice(3); }
    const f = (col === "items" ? FIELDS.items(smartType(r?.type)) : FIELDS[col]?.() || []).find(x => x.key === key);
    return f ? f.label : EXTRA_LABELS[key] || cap(key);
  }
  function fmtVal(col, r, key, v) {
    if (v === "" || v == null) return "—";
    if (key === "stage") { const s = stagesOf(col, r).find(x => x.id === v) || (col === "deals" ? pipelines().flatMap(p => p.stages || []).find(x => x.id === v) : null); return s ? s.name : String(v); }
    if (key === "pipeline") return pipelines().find(p => p.id === v)?.name || String(v);
    if (key === "owner") return Data.person(v).name;
    if (key === "contact") return name("contacts", v) || "—";
    if (key === "company" || key === "vendor") return name("companies", v) || "—";
    if (key === "amount" || key === "value") return Apps.money(v);
    if (key === "close") return Apps.fmtDate(v);
    if (key === "status") return LEAD_ST.find(s => s[0] === v)?.[1] || String(v);
    if (key === "type" && col === "companies") return CTYPES.find(s => s[0] === v)?.[1] || String(v);
    if (v === true) return "Yes"; if (v === false) return "No";
    return String(v);
  }
  // custom fields → Apps.form fields (url is a text field)
  const cfFormFields = list => list.map(f => ({
    key: "cf_" + f.key, label: f.label, half: f.type !== "text" && f.type !== "url",
    type: f.type === "url" ? "text" : f.type === "select" ? "select" : f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "checkbox" ? "checkbox" : "text",
    options: f.type === "select" ? [["", "—"], ...(f.options || []).map(o => [o, o])] : undefined, placeholder: f.type === "url" ? "https://" : "",
  }));

  /* ---------- history (audit log) via Data.hooks ---------- */
  let quiet = 0; // > 0 while CRM code makes bookkeeping writes that must not be logged one by one
  const HSKIP = new Set(["id", "at", "by", "activities", "deletedAt", "deletedBy", "closedAt", "mergedInto", "comments", "deleted"]);
  const brief = v => v == null ? "" : Array.isArray(v) ? v.length + (v.length === 1 ? " item" : " items") : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : typeof v === "string" ? v.slice(0, 120) : v;
  function diff(a = {}, b = {}) {
    const out = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
      if (HSKIP.has(k)) return;
      if (k === "custom") {
        const ca = a.custom || {}, cb = b.custom || {};
        new Set([...Object.keys(ca), ...Object.keys(cb)]).forEach(ck => { if (JSON.stringify(ca[ck] ?? "") !== JSON.stringify(cb[ck] ?? "")) out["cf:" + ck] = [brief(ca[ck]), brief(cb[ck])]; });
        return;
      }
      if (JSON.stringify(a[k] ?? "") !== JSON.stringify(b[k] ?? "")) out[k] = [brief(a[k]), brief(b[k])];
    });
    return out;
  }
  // plain edits to the same record within a few seconds (e.g. typing in the products table) become one history doc
  const pendingHist = new Map();
  function flushHist(key) {
    const p = pendingHist.get(key); if (!p) return;
    pendingHist.delete(key); clearTimeout(p.timer);
    Object.keys(p.fields).forEach(k => { if (JSON.stringify(p.fields[k][0]) === JSON.stringify(p.fields[k][1])) delete p.fields[k]; });
    if (Object.keys(p.fields).length) Data.add("history", { col: p.col, id: p.id, action: "updated", fields: p.fields, title: p.title, ...(p.type != null ? { type: p.type } : {}) });
  }
  addEventListener("pagehide", () => [...pendingHist.keys()].forEach(flushHist));
  Data.hooks.add((kind, col, after, before) => {
    if (quiet || !HIST_COLS.includes(col)) return;
    const r = after || before; if (!r || !r.id) return;
    const key = col + ":" + r.id, title = String(recName(r)).slice(0, 120), type = col === "items" ? r.type || "" : null;
    let action, fields = {};
    if (kind === "add") action = "created";
    else if (kind === "remove") { action = "deleted"; fields = { forever: [false, true] }; }
    else {
      if (!before) return;
      if (!!before.deleted !== !!after.deleted) action = after.deleted ? "deleted" : "restored";
      else { fields = diff(before, after); if (!Object.keys(fields).length) return; action = fields.stage ? "stage" : "updated"; }
    }
    if (action === "updated") {
      const p = pendingHist.get(key) || { col, id: r.id, fields: {}, type };
      Object.entries(fields).forEach(([k, v]) => { p.fields[k] = p.fields[k] ? [p.fields[k][0], v[1]] : v; });
      p.title = title; clearTimeout(p.timer); p.timer = setTimeout(() => flushHist(key), 4000);
      pendingHist.set(key, p);
      return;
    }
    flushHist(key);
    Data.add("history", { col, id: r.id, action, fields, title, ...(type != null ? { type } : {}) });
  });
  async function quietly(fn) { quiet++; try { return await fn(); } finally { quiet--; } }

  /* ---------- activities ---------- */
  const acts = () => Data.list("activities").filter(a => a && a.entity && a.entity.col && a.entity.id);
  const actsFor = (col, id) => acts().filter(a => a.entity.col === col && a.entity.id === id);
  const isPlan = a => !a.done && a.type !== "note";
  // next open activity per record: "col:id" → activity (earliest deadline first, then ones without a deadline)
  function nextIndex() {
    const m = new Map();
    acts().forEach(a => {
      if (!isPlan(a)) return;
      const k = a.entity.col + ":" + a.entity.id, cur = m.get(k);
      if (!cur || (a.due || Infinity) < (cur.due || Infinity)) m.set(k, a);
    });
    return m;
  }
  let NX = new Map();
  function when(ms) {
    if (!ms) return "No deadline";
    const d = new Date(ms), t0 = startOfDay(), hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (ms >= t0 && ms < t0 + DAY) return "Today " + hm;
    if (ms >= t0 + DAY && ms < t0 + 2 * DAY) return "Tomorrow " + hm;
    if (ms >= t0 - DAY && ms < t0) return "Yesterday " + hm;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + hm;
  }
  const late = a => !!(a && a.due && a.due < Date.now() && !a.done);
  function nextChip(a, empty = true) {
    if (!a) return empty ? h("span", { class: "crm-next none", text: "No activity" }) : null;
    return h("span", { class: "crm-next" + (late(a) ? " late" : ""), title: a.subject || "" },
      late(a) ? h("i", { class: "crm-dot" }) : null, h("span", { text: (ATYPES[a.type]?.[0] || "📌") + " " + (a.subject || ATYPES[a.type]?.[1] || "Activity") }),
      h("small", { text: when(a.due) }));
  }
  function markDone(a, done = true) {
    Data.update("activities", a.id, { done, doneAt: done ? Date.now() : null });
    if (done) UI.toast(`✅ ${ATYPES[a.type]?.[1] || "Activity"} done`, { label: "Undo", run: () => Data.update("activities", a.id, { done: false, doneAt: null }) });
  }

  /* reminders for my own activities when they fall due (local alert, no writes) + sidebar badge with my overdue count */
  let ticking = false;
  function tick() {
    try {
      const now = Date.now(), mine = Data.list("activities").filter(a => a && isPlan(a) && a.owner === me() && a.due && a.entity && recLive(a.entity));
      Apps.badge("crm", mine.filter(a => a.due < now).length);
      if (!window.Notify?.alert) return;
      let seen; try { seen = JSON.parse(localStorage.getItem("lumen-crm-reminded") || "[]"); } catch { seen = []; }
      let changed = false;
      mine.filter(a => a.due <= now && a.due > now - 10 * 60000 && !seen.includes(a.id)).forEach(a => {
        const r = Data.get(a.entity.col, a.entity.id);
        Notify.alert({ title: `${ATYPES[a.type]?.[0] || "⏰"} ${a.subject || "Activity"}`, body: "Due now" + (r ? " · " + recName(r) : ""), link: `#/app/crm/open:${a.entity.col}:${a.entity.id}`, icon: "⏰", tag: "crm-" + a.id });
        seen.push(a.id); changed = true;
      });
      if (changed) try { localStorage.setItem("lumen-crm-reminded", JSON.stringify(seen.slice(-200))); } catch {}
    } catch (e) { console.warn("crm reminders", e); }
  }
  function startTicking() {
    if (ticking) return; ticking = true;
    setTimeout(tick, 1500); setInterval(tick, 60000); Apps.onWorkspace.add(() => setTimeout(tick, 4000));
  }

  /* ---------- create / edit ---------- */
  async function edit(col, rec = {}, preset = {}) {
    const isNew = !rec.id, type = rec.type || preset.type, st = col === "items" ? smartType(type) : null;
    if (col === "items" && !st) { UI.toast("That smart process no longer exists"); return null; }
    const base = col === "items" ? FIELDS.items(st) : FIELDS[col]();
    const cfs = customFields(col, { type });
    const vals = { owner: me(), status: "new", type: "client", source: SOURCES[0], ...preset, ...rec };
    if (col === "items") vals.stage = vals.stage || st.stages?.[0]?.id || "";
    if (col === "deals") { const pid = pipeline(vals.pipeline).id; vals._stage = pid + "::" + (stagesFor(pid).some(s => s.id === vals.stage) ? vals.stage : stagesFor(pid)[0]?.id); }
    Object.entries(vals.custom || {}).forEach(([k, v]) => { vals["cf_" + k] = v; });
    const title = (isNew ? "New " : "Edit ") + (col === "items" ? (st.name || "item").toLowerCase() : LABEL[col]);
    const pending = Apps.form(title, [...base, ...cfFormFields(cfs)], vals, { ok: isNew ? "Create" : "Save" });
    if (col === "leads" || col === "contacts" || col === "companies") dupWatch(col, rec.id);
    const v = await pending;
    if (!v) return null;
    const data = {};
    base.forEach(f => { if (f.key !== "_stage") data[f.key] = v[f.key] ?? ""; });
    if (cfs.length || rec.custom) {
      const custom = { ...(rec.custom || {}) };
      cfs.forEach(f => { const x = v["cf_" + f.key]; custom[f.key] = f.type === "checkbox" ? !!x : x ?? ""; });
      data.custom = custom;
    }
    if (col === "deals") {
      const [pid, sid] = String(v._stage || "").split("::"); data.pipeline = pid || "default"; data.stage = sid || stagesFor(pid)[0]?.id || "new";
      const sem = stagesFor(data.pipeline).find(s => s.id === data.stage)?.sem || "process";
      if (isNew || data.stage !== rec.stage) data.closedAt = sem !== "process" ? Date.now() : null;
    }
    if (col === "items") data.type = type;
    if (isNew) {
      const nid = await Data.add(col, { ...data, activities: [] });
      if (data.owner) Data.notify(data.owner, `${ICON[col]} <b>${esc(Data.me().name)}</b> made you responsible for ${esc(col === "items" ? st.name.toLowerCase() : LABEL[col])} “${esc(recName(data))}”`, `#/app/crm/open:${col}:${nid}`);
      return nid;
    }
    if (data.owner && data.owner !== rec.owner) Data.notify(data.owner, `${ICON[col]} <b>${esc(Data.me().name)}</b> made you responsible for ${esc(typeLabel(col))} “${esc(recName(data))}”`, `#/app/crm/open:${col}:${rec.id}`);
    await Data.update(col, rec.id, data);
    return rec.id;
  }

  /* ---------- duplicates ---------- */
  function dupesOf(col, v, exceptId) {
    const nm = low(v.name), em = low(v.email), ph = digits(v.phone);
    if (!nm && !em && ph.length < 5) return [];
    return live(col).filter(r => r.id !== exceptId && ((nm && low(r.name) === nm) || (em && low(r.email) === em) || (ph.length >= 5 && digits(r.phone) === ph)));
  }
  // live "Possible duplicate" hint inside the Apps.form modal that was just opened
  function dupWatch(col, exceptId) {
    const modal = [...document.querySelectorAll("#layer .modal")].pop(), form = modal?.querySelector(".f-grid");
    if (!form) return;
    const input = label => [...form.querySelectorAll(".f-row")].find(r => r.firstChild?.textContent === label)?.querySelector("input");
    const ins = { name: input({ leads: "Lead name", contacts: "Full name", companies: "Company name" }[col]), email: input("Email"), phone: input("Phone") };
    const warn = h("div", { class: "crm-dup", hidden: true });
    form.prepend(warn);
    const check = () => {
      const d = dupesOf(col, { name: ins.name?.value, email: ins.email?.value, phone: ins.phone?.value }, exceptId);
      warn.hidden = !d.length;
      if (!d.length) return;
      warn.replaceChildren(h("span", { text: "⚠️ Possible duplicate: " }), ...d.slice(0, 3).flatMap((r, i) => [i ? ", " : "", h("a", { text: recName(r), title: "Open it", onclick: () => {
        modal.querySelector(".f-actions button.btn:not(.primary):not(.danger)")?.click();
        setTimeout(() => openRecord(col, r.id), 60);
      } })]));
    };
    let t; Object.values(ins).forEach(i => i && i.addEventListener("input", () => { clearTimeout(t); t = setTimeout(check, 200); }));
    check();
  }
  function dupeGroups(col) {
    const rows = live(col).sort((a, b) => (a.at || 0) - (b.at || 0)), parent = rows.map((_, i) => i), seen = {};
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    rows.forEach((r, i) => {
      [low(r.name) && "n:" + low(r.name), low(r.email) && "e:" + low(r.email), digits(r.phone).length >= 5 && "p:" + digits(r.phone)].filter(Boolean).forEach(k => {
        if (seen[k] == null) seen[k] = i; else parent[find(i)] = find(seen[k]);
      });
    });
    const groups = {};
    rows.forEach((r, i) => (groups[find(i)] ||= []).push(r));
    return Object.values(groups).filter(g => g.length > 1);
  }
  async function merge(col, group) {
    const [keep, ...rest] = group, patch = {}, custom = { ...(keep.custom || {}) };
    const NO = new Set(["id", "at", "by", "deleted", "deletedAt", "deletedBy", "activities", "custom", "mergedInto", "comments"]);
    rest.forEach(o => {
      Object.entries(o).forEach(([k, v]) => { if (!NO.has(k) && (keep[k] == null || keep[k] === "") && patch[k] == null && v !== "" && v != null) patch[k] = v; });
      Object.entries(o.custom || {}).forEach(([k, v]) => { if ((custom[k] == null || custom[k] === "") && v !== "" && v != null) custom[k] = v; });
    });
    if (Object.keys(custom).length) patch.custom = custom;
    const inline = [keep, ...rest].flatMap(r => r.activities || []).sort((a, b) => (b.at || 0) - (a.at || 0));
    if (inline.length) patch.activities = inline;
    const ids = rest.map(r => r.id);
    const before = { ...keep };
    await quietly(async () => {
      const move = (c, field) => Data.list(c).filter(x => ids.includes(x[field])).forEach(x => Data.update(c, x.id, { [field]: keep.id }));
      if (col === "contacts") { move("deals", "contact"); move("quotes", "contact"); }
      if (col === "companies") { move("deals", "company"); move("contacts", "company"); move("quotes", "company"); move("products", "vendor"); Data.list("inventory").filter(x => x.kind === "doc" && ids.includes(x.vendor)).forEach(x => Data.update("inventory", x.id, { vendor: keep.id })); }
      acts().filter(a => a.entity.col === col && ids.includes(a.entity.id)).forEach(a => Data.update("activities", a.id, { entity: { col, id: keep.id } }));
      rest.forEach(o => Data.update(col, o.id, { deleted: true, deletedAt: Date.now(), deletedBy: me(), mergedInto: keep.id }));
      if (Object.keys(patch).length) await Data.update(col, keep.id, patch);
    });
    const fields = diff(before, { ...before, ...patch }); fields.merged = ["", rest.map(recName).join(", ").slice(0, 200)];
    Data.add("history", { col, id: keep.id, action: "updated", fields, title: recName(keep) });
    UI.toast(`🔗 Merged ${rest.length + 1} records into “${recName(keep)}”`);
  }
  function findDupes(col) {
    const box = h("div", { class: "crm-dupes" });
    const paint = () => {
      const groups = dupeGroups(col);
      if (!groups.length) return box.replaceChildren(Apps.empty("🎉", `No duplicate ${PLURAL[col]} found.`));
      box.replaceChildren(h("p", { class: "crm-hint", text: `${groups.length} group${groups.length > 1 ? "s" : ""} share a name, email or phone. Merging keeps the first record, fills its empty fields from the others and moves their deals, activities and documents to it.` }),
        ...groups.map(g => h("div", { class: "crm-dupe-g glass" },
          ...g.map((r, i) => h("div", { class: "crm-dupe-r" + (i ? "" : " keep") },
            h("span", { class: "crm-dupe-k", text: i ? "Merge" : "Keep" }),
            h("a", { text: recName(r), onclick: () => { m.close(); openRecord(col, r.id); } }),
            h("small", { text: [r.email, r.phone, r.companyName, col === "contacts" ? name("companies", r.company) : ""].filter(Boolean).join(" · ") || UI.timeAgo(r.at) }))),
          h("button", { class: "btn primary", text: "Merge", onclick: async () => { await merge(col, g); paint(); } }))));
    };
    const m = UI.modal("Find duplicates · " + cap(PLURAL[col]), box);
    m.el.style.width = "600px";
    paint();
  }

  /* ---------- delete, restore ---------- */
  function softDelete(col, ids) {
    ids = [].concat(ids).filter(Boolean);
    if (!ids.length) return;
    ids.forEach(id => Data.update(col, id, { deleted: true, deletedAt: Date.now(), deletedBy: me() }));
    UI.toast(ids.length === 1 ? "🗑️ Moved to the recycle bin" : `🗑️ ${ids.length} records moved to the recycle bin`, { label: "Undo", run: () => ids.forEach(id => restore(col, id)) });
  }
  const restore = (col, id) => Data.update(col, id, { deleted: false, deletedAt: null, deletedBy: null });
  async function hardDelete(col, id, ask = true) {
    if (ask && !(await UI.confirm("Delete this record forever? This can't be undone.", "Delete forever"))) return false;
    actsFor(col, id).forEach(a => Data.remove("activities", a.id));
    await Data.remove(col, id);
    return true;
  }

  /* ---------- stages ---------- */
  function askReason(st) {
    return new Promise(res => {
      let done = false;
      const won = st.sem === "won";
      const inp = h("input", { class: "menu-input", placeholder: won ? "e.g. Best price, great relationship" : "e.g. Too expensive, chose a competitor", maxlength: 200 });
      const ok = () => { done = true; m.close(); res(inp.value.trim()); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
      const m = UI.modal((won ? "🏆 " : "") + "Move to “" + st.name + "”", h("div", { class: "crm-reason" },
        h("p", { text: won ? "Nice work! What made it happen?" : "What happened? A short reason helps the team learn." }),
        h("div", { class: "crm-chips" }, ...(won ? WON_R : LOST_R).map(t => h("button", { type: "button", class: "chip-btn", text: t, onclick: () => { inp.value = t; inp.focus(); } }))),
        inp,
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { class: "btn primary", text: "Move", onclick: ok })))),
        { onClose: () => !done && res(null) });
      m.el.style.width = "460px";
      setTimeout(() => inp.focus(), 60);
    });
  }
  // move a deal or smart-process item to a stage; won/lost deals ask for a short reason
  async function setStage(col, r, sid, reason) {
    if (!r || r.stage === sid) return false;
    const st = stagesOf(col, r).find(s => s.id === sid);
    if (!st) return false;
    const patch = { stage: sid };
    if (col === "deals") {
      patch.pipeline = pipeOf(r);
      if (st.sem !== "process") {
        if (reason == null) reason = await askReason(st);
        if (reason == null) return false;
        patch.closeReason = reason; patch.closedAt = Date.now();
      } else { patch.closedAt = null; patch.closeReason = ""; }
    }
    Data.update(col, r.id, patch);
    if (st.sem === "won") UI.toast(col === "deals" ? `🏆 Deal won: ${recName(r)} (${Apps.money(r.amount)})` : `🎉 ${recName(r)} is done`);
    return true;
  }
  function moveToPipeline(d, pid) {
    const first = stagesFor(pid).find(s => s.sem === "process") || stagesFor(pid)[0];
    if (!first) return;
    Data.update("deals", d.id, { pipeline: pid, stage: first.id, closedAt: null });
    UI.toast("➡️ Moved to " + pipeline(pid).name);
  }

  /* ---------- lead conversion ---------- */
  async function convert(lead) {
    let company = "";
    if (lead.companyName) company = live("companies").find(c => low(c.name) === low(lead.companyName))?.id || await Data.add("companies", { name: lead.companyName, type: "client", owner: lead.owner || me(), activities: [] });
    const contact = (lead.email && live("contacts").find(c => low(c.email) === low(lead.email))?.id) || await Data.add("contacts", { name: lead.name, email: lead.email || "", phone: lead.phone || "", company, owner: lead.owner || me(), activities: [] });
    const stages = stagesFor("default"), st = stages.find(s => s.id === "qualified") || stages.filter(s => s.sem === "process")[1] || stages[0];
    const deal = await Data.add("deals", { title: (lead.companyName || lead.name) + " deal", amount: lead.value || 0, pipeline: "default", stage: st?.id || "new", contact, company, owner: lead.owner || me(), lead: lead.id,
      activities: [{ kind: "note", text: "Converted from lead (" + (lead.source || "unknown source") + ")", by: me(), at: Date.now() }] });
    await Data.update("leads", lead.id, { status: "converted", deal, contact });
    await quietly(() => acts().filter(a => a.entity.col === "leads" && a.entity.id === lead.id && isPlan(a)).forEach(a => Data.update("activities", a.id, { entity: { col: "deals", id: deal } })));
    UI.toast("✅ Lead converted"); openRecord("deals", deal);
  }

  /* ---------- sales documents (Apps.Sales) ---------- */
  function newQuote(kind, d) {
    if (!Apps.Sales?.newQuote) return UI.toast("Estimates and invoices aren't available right now");
    Apps.Sales.newQuote({ kind, deal: d.id, contact: d.contact || "", company: d.company || "", items: d.products || [] });
  }
  const QSTAT = { draft: "gray", sent: "blue", accepted: "green", declined: "red", paid: "green", overdue: "red", cancelled: "gray" };
  function quoteTotal(q) {
    try { if (Apps.Sales?.totals) return Apps.Sales.totals(q.items || []).total; } catch {}
    return (q.items || []).reduce((a, it) => { const line = (+it.qty || 0) * (+it.price || 0) * (1 - (+it.discount || 0) / 100); return a + line * (1 + (+it.tax || 0) / 100); }, 0);
  }

  /* ---------- activity composer (inside a record panel) ---------- */
  const HINTS = { call: "Call to discuss the proposal", meeting: "Demo at their office", task: "Prepare the contract", email: "Send the price list" };
  function composer(col, id) {
    let type = "note", owner = me();
    const subj = h("textarea", { class: "menu-input f-ta crm-act-in", rows: 2 });
    const date = h("input", { type: "date", class: "chip-in" }), time = h("input", { type: "time", class: "chip-in", value: "10:00" });
    const who = h("button", { type: "button", class: "chip-btn crm-who", onclick: () => Apps.personPicker(who, p => { owner = p ? p.key : me(); paintWho(); }) });
    const go = h("button", { class: "btn primary", type: "button", onclick: () => save() });
    const plan = h("div", { class: "crm-act-plan" }, h("label", null, h("span", { text: "Deadline" }), date, time), h("label", null, h("span", { text: "Responsible" }), who));
    const seg = h("div", { class: "seg crm-act-seg" }, ...Object.entries(ATYPES).map(([k, [ic, l]]) => h("button", { type: "button", class: k === type ? "on" : "", onclick: e => {
      type = k; seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); paint(); subj.focus();
    } }, ic + " " + l)));
    function paintWho() { const p = Data.person(owner); who.replaceChildren(Apps.avatar(p, 18), h("span", { text: owner === me() ? "Me" : p.name })); }
    function paint() {
      subj.placeholder = type === "note" ? "Write a comment… (Enter to post, @ to mention)" : "What needs to happen? e.g. " + HINTS[type];
      go.textContent = type === "note" ? "Comment" : "Plan " + ATYPES[type][1].toLowerCase();
      plan.hidden = type === "note";
      if (type !== "note" && !date.value) date.value = Apps.today();
    }
    async function save() {
      const text = subj.value.trim();
      if (!text) return subj.focus();
      const note = type === "note", due = !note && date.value ? new Date(date.value + "T" + (time.value || "09:00")).getTime() : null;
      const r = Data.get(col, id), who2 = note ? me() : owner;
      subj.value = ""; subj.blur();
      await Data.add("activities", { type, subject: text, desc: "", due, done: note, doneAt: note ? Date.now() : null, owner: who2, entity: { col, id } });
      const link = `#/app/crm/open:${col}:${id}`;
      if (!note && who2 !== me()) Data.notify(who2, `${ATYPES[type][0]} <b>${esc(Data.me().name)}</b> planned a ${ATYPES[type][1].toLowerCase()} for you${due ? " · " + esc(when(due)) : ""}: “${esc(text)}”`, link, recName(r));
      if (note) Apps.mentioned(text).forEach(k => Data.notify(k, `💬 <b>${esc(Data.me().name)}</b> mentioned you on ${esc(typeLabel(col))} “${esc(recName(r))}”`, link, text));
      UI.toast(note ? "💬 Comment added" : `📌 ${ATYPES[type][1]} planned`);
    }
    subj.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && type === "note") { e.preventDefault(); save(); } });
    Apps.mentionAssist(subj);
    paint(); paintWho();
    return h("div", { class: "crm-composer glass" }, seg, subj, h("div", { class: "crm-act-foot" }, plan, h("span", { class: "grow" }), go));
  }

  /* ---------- timeline: old inline activities + activities + history + comments, newest first ---------- */
  function histItem(col, r, x) {
    const by = x.by, at = x.at;
    if (x.action === "created") return { at, by, ic: "✨", t: "Created" };
    if (x.action === "restored") return { at, by, ic: "♻️", t: "Restored from the recycle bin" };
    if (x.action === "deleted") return { at, by, ic: "🗑️", t: x.fields?.forever ? "Deleted forever" : "Moved to the recycle bin" };
    const f = x.fields || {}, lines = [];
    Object.entries(f).forEach(([k, pair]) => {
      if (!Array.isArray(pair)) return;
      if (k === "merged") return lines.push("Merged in: " + pair[1]);
      if (k === "stage" || k === "pipeline" && x.action === "stage") return;
      lines.push(`${labelOf(col, k, r)}: ${fmtVal(col, r, k.startsWith("cf:") ? "" : k, pair[0])} → ${fmtVal(col, r, k.startsWith("cf:") ? "" : k, pair[1])}`);
    });
    if (x.action === "stage" && f.stage) {
      const fake = { ...r, pipeline: f.pipeline ? f.pipeline[1] : r.pipeline };
      return { at, by, ic: "🚩", t: `Stage: ${fmtVal(col, fake, "stage", f.stage[0])} → ${fmtVal(col, fake, "stage", f.stage[1])}`, text: lines.join("\n") };
    }
    return { at, by, ic: "✏️", t: "Changed", text: lines.join("\n") || "Details updated" };
  }
  function timeline(col, r) {
    const items = [];
    (r.activities || []).forEach(a => { const [ic, l] = OLD_ACT[a.kind] || OLD_ACT.note; items.push({ at: a.at, by: a.by, ic, t: l, text: a.text }); });
    (r.comments || []).forEach(c => items.push({ at: c.at, by: c.by, ic: "💬", t: "Comment", text: c.text }));
    actsFor(col, r.id).forEach(a => {
      const [ic, l] = ATYPES[a.type] || ATYPES.task;
      if (a.type === "note") return items.push({ at: a.at, by: a.by, ic, t: "Comment", text: a.subject, cls: "cmt" });
      items.push({ at: a.at, by: a.by, ic, t: a.done ? l + " done" : l + " planned", text: a.subject, cls: a.done ? "done" : late(a) ? "late" : "",
        sub: (a.due ? "Deadline " + when(a.due) + " · " : "") + "Responsible: " + Data.person(a.owner).name + (a.done && a.doneAt ? " · done " + UI.timeAgo(a.doneAt) : "") });
    });
    const hist = Data.list("history").filter(x => x.col === col && x.id === r.id);
    hist.forEach(x => items.push(histItem(col, r, x)));
    if (!hist.some(x => x.action === "created")) items.push({ at: r.at, by: r.by, ic: "✨", t: "Created" });
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    return h("div", { class: "timeline crm-tl" }, ...items.slice(0, 150).map(it => h("div", { class: "tl-item " + (it.cls || "") },
      h("span", { class: "tl-ic", text: it.ic }),
      h("div", { class: "tl-b" }, h("div", { class: "cmt-h" }, h("b", { text: it.t }), h("small", { text: Data.person(it.by).name + " · " + (it.at ? UI.timeAgo(it.at) : "") })),
        it.text ? h("div", { class: "cmt-t", text: it.text }) : null, it.sub ? h("small", { class: "tl-sub", text: it.sub }) : null))));
  }

  /* ---------- record slider ---------- */
  function stageBar(col, r) {
    const ss = stagesOf(col, r), cur = stageOf(col, r), ci = ss.findIndex(s => s.id === cur.id), closed = cur.sem !== "process";
    return h("div", { class: "stage-bar crm-stagebar" }, ...ss.map((s, i) => h("button", {
      class: "sb-step" + (s.id === cur.id ? " on" : "") + (i < ci && s.sem === "process" && cur.sem !== "lost" ? " past" : "") + (closed && s.id !== cur.id && s.sem !== "process" ? " dim" : ""),
      style: { "--sc": `var(--c-${s.color || "gray"})`, "--sb": `var(--bg-${s.color || "gray"})` }, title: s.name, text: s.name,
      onclick: () => setStage(col, Data.get(col, r.id), s.id),
    })));
  }
  function infoGrid(col, r) {
    const info = [];
    const add = (k, v) => { if (v === "" || v == null || v === false) return; info.push(h("span", { text: k }), typeof v === "string" || typeof v === "number" ? h("span", { text: String(v) }) : v); };
    const link = (c, id) => { const n = name(c, id); return n ? h("a", { class: "crm-link", text: n, onclick: () => openRecord(c, id) }) : ""; };
    if (col === "deals") {
      add("Amount", h("b", { text: Apps.money(r.amount) })); if (pipelines().length > 1) add("Pipeline", pipeline(r.pipeline).name);
      add("Stage", tagEl(dStage(r).name, dStage(r).color)); add("Contact", link("contacts", r.contact)); add("Company", link("companies", r.company)); add("Expected close", Apps.fmtDate(r.close));
      if (!isOpenDeal(r) && r.closeReason) add(dStage(r).sem === "won" ? "Why we won" : "Why we lost", r.closeReason);
    }
    if (col === "leads") { add("Status", leadTag(r.status)); add("Company", r.companyName); add("Source", r.source); add("Email", r.email ? h("a", { class: "crm-link", href: "mailto:" + r.email, text: r.email }) : ""); add("Phone", r.phone ? h("a", { class: "crm-link", href: "tel:" + r.phone, text: r.phone }) : ""); add("Value", r.value ? Apps.money(r.value) : ""); if (r.deal) add("Deal", link("deals", r.deal)); }
    if (col === "contacts") { add("Position", r.position); add("Company", link("companies", r.company)); add("Email", r.email ? h("a", { class: "crm-link", href: "mailto:" + r.email, text: r.email }) : ""); add("Phone", r.phone ? h("a", { class: "crm-link", href: "tel:" + r.phone, text: r.phone }) : ""); }
    if (col === "companies") { add("Type", tagEl(fmtVal("companies", r, "type", r.type || "client"), { client: "blue", vendor: "orange", partner: "purple" }[r.type || "client"])); add("Industry", r.industry); add("Employees", r.size); add("Website", r.website ? h("a", { class: "crm-link", href: /^https?:/i.test(r.website) ? r.website : "https://" + r.website, target: "_blank", rel: "noopener", text: r.website }) : ""); add("Phone", r.phone); add("Email", r.email); }
    if (col === "items") { add("Stage", tagEl(stageOf(col, r).name, stageOf(col, r).color)); if (r.amount) add("Amount", h("b", { text: Apps.money(r.amount) })); }
    if (r.owner) add("Responsible", h("span", { class: "who" }, Apps.avatar(Data.person(r.owner), 20), Data.person(r.owner).name));
    customFields(col, r).forEach(f => {
      const v = (r.custom || {})[f.key];
      if (v === "" || v == null) return;
      if (f.type === "checkbox") return add(f.label, v ? "✓ Yes" : "No");
      if (f.type === "url") return add(f.label, h("a", { class: "crm-link", href: /^https?:/i.test(v) ? v : "https://" + v, target: "_blank", rel: "noopener", text: String(v) }));
      if (f.type === "date") return add(f.label, Apps.fmtDate(v));
      if (f.type === "number") return add(f.label, (+v).toLocaleString());
      add(f.label, String(v));
    });
    add("Created", new Date(r.at || Date.now()).toLocaleDateString() + " by " + Data.person(r.by).name);
    return h("div", { class: "td-grid crm-info" }, ...info);
  }
  function related(col, r) {
    const out = [], rel = (c, x, extra) => h("button", { class: "rel", onclick: () => openRecord(c, x.id) }, h("span", { text: ICON[c] + " " + recName(x) }), extra ? h("small", { text: extra }) : null);
    const dealExtra = d => Apps.money(d.amount) + " · " + dStage(d).name;
    if (col === "companies") { live("contacts").filter(c => c.company === r.id).forEach(c => out.push(rel("contacts", c, c.position))); live("deals").filter(d => d.company === r.id).forEach(d => out.push(rel("deals", d, dealExtra(d)))); }
    if (col === "contacts") live("deals").filter(d => d.contact === r.id).forEach(d => out.push(rel("deals", d, dealExtra(d))));
    if (col === "deals" && r.lead && Data.get("leads", r.lead) && !Data.get("leads", r.lead).deleted) out.push(rel("leads", Data.get("leads", r.lead), "Lead"));
    if ((col === "companies" || col === "contacts") && Apps.Sales?.openQuote) {
      Data.list("quotes").filter(q => !q.deleted && q[col === "companies" ? "company" : "contact"] === r.id).forEach(q => out.push(h("button", { class: "rel", onclick: () => Apps.Sales.openQuote(q.id) },
        h("span", { text: (q.kind === "invoice" ? "🧾 " : "📝 ") + (q.number || cap(q.kind || "estimate")) + (q.title ? " · " + q.title : "") }), h("small", { text: Apps.money(quoteTotal(q)) + " · " + (q.status || "draft") }))));
    }
    if (col === "companies" && r.type === "vendor") Data.list("products").filter(p => !p.deleted && p.vendor === r.id).forEach(p => out.push(h("div", { class: "rel static" }, h("span", { text: "📦 " + (p.name || "Product") }), h("small", { text: Apps.money(p.price) }))));
    return out;
  }
  function dealDocs(d) {
    const qs = Data.list("quotes").filter(q => q.deal === d.id && !q.deleted).sort((a, b) => (b.at || 0) - (a.at || 0));
    return h("div", { class: "crm-docs" },
      h("div", { class: "crm-doc-btns" },
        h("button", { class: "btn", text: "📝 Create estimate", onclick: () => newQuote("estimate", Data.get("deals", d.id)) }),
        h("button", { class: "btn", text: "🧾 Create invoice", onclick: () => newQuote("invoice", Data.get("deals", d.id)) })),
      qs.length ? h("div", { class: "crm-doc-list" }, ...qs.map(q => h("button", { class: "crm-doc", onclick: () => Apps.Sales?.openQuote ? Apps.Sales.openQuote(q.id) : UI.toast("Documents aren't available right now") },
        h("span", { class: "crm-doc-ic", text: q.kind === "invoice" ? "🧾" : "📝" }),
        h("span", { class: "crm-doc-t" }, h("b", { text: q.number || cap(q.kind || "estimate") }), h("small", { text: (q.title || cap(q.kind || "")) + (q.issue ? " · " + Apps.fmtDate(q.issue) : "") })),
        tagEl(cap(q.status || "draft"), QSTAT[q.status || "draft"]), h("b", { class: "crm-doc-sum", text: Apps.money(quoteTotal(q)) })))) : null);
  }
  function recMenu(anchor, col, id, panel) {
    const r = Data.get(col, id); if (!r) return;
    const others = col === "deals" ? pipelines().filter(p => p.id !== pipeOf(r)) : [];
    UI.menu(anchor, [
      { label: "Edit", icon: "text", onClick: () => edit(col, Data.get(col, id)) },
      col === "leads" && r.status !== "converted" ? { label: "Convert to contact + deal", iconHtml: "🔁", onClick: () => convert(r) } : null,
      ...(others.length ? [{ section: "Move to pipeline" }, ...others.map(p => ({ label: p.name, iconHtml: "➡️", onClick: () => moveToPipeline(Data.get("deals", id), p.id) }))] : []),
      { sep: true },
      r.deleted ? { label: "Restore", icon: "restore", onClick: () => restore(col, id) } : { label: "Move to recycle bin", icon: "trash", danger: true, onClick: () => { softDelete(col, id); panel.close(); } },
      r.deleted ? { label: "Delete forever", icon: "trash", danger: true, onClick: async () => { if (await hardDelete(col, id)) panel.close(); } } : null,
    ], { align: "end" });
  }
  function openRecord(col, id) {
    const r0 = Data.get(col, id);
    if (!r0) return UI.toast("That record is no longer available");
    const body = h("div", { class: "crm-rec" });
    const more = h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: () => recMenu(more, col, id, p) });
    const p = Apps.panel(recLabel(col, r0), body, [h("button", { class: "btn", text: "Edit", onclick: () => edit(col, Data.get(col, id)) }), more]);
    p.el.classList.add("crm-slider");
    const comp = composer(col, id), prodBox = h("div", { class: "crm-prods" });
    let prodSig = null, ready = false;
    const redraw = UI.liveDraw(body, draw);
    const offs = [col, "activities", "history", "settings", ...(col === "deals" ? ["quotes"] : []), ...(col === "companies" || col === "contacts" ? ["quotes", "deals"] : [])]
      .filter((c, i, a) => a.indexOf(c) === i).map(c => Data.on(c, () => ready && redraw()));
    p.onClose = () => offs.forEach(f => f());
    function draw() {
      const r = Data.get(col, id);
      if (!r) return p.close();
      const open = actsFor(col, id).filter(isPlan).sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
      const rel = related(col, r);
      if (col === "deals") {
        const sig = JSON.stringify(r.products || []) + "|" + r.amount;
        if (Apps.Sales?.dealProducts) {
          if (sig !== prodSig && !prodBox.contains(document.activeElement)) {
            prodSig = sig; prodBox.replaceChildren();
            try { Apps.Sales.dealProducts(prodBox, r); } catch (e) { console.error(e); prodBox.replaceChildren(h("div", { class: "crm-hint", text: "Products couldn't load." })); }
          }
        } else prodBox.replaceChildren((r.products || []).length ? h("div", { class: "crm-hint", text: (r.products || []).map(x => `${x.name} × ${x.qty || 1}`).join(", ") }) : h("div", { class: "crm-hint", text: "Products will appear here once the catalog is available." }));
      }
      const head = h("div", { class: "crm-rec-head" },
        h("div", { class: "crm-rec-ic", text: col === "items" ? (smartType(r.type)?.icon || "🧩") : ICON[col] }),
        h("div", { class: "crm-rec-ht" }, h("div", { class: "peek-title", text: recName(r) }),
          h("div", { class: "crm-rec-sub" }, col === "deals" ? h("b", { text: Apps.money(r.amount) }) : null, col === "deals" && pipelines().length > 1 ? h("span", { text: pipeline(r.pipeline).name }) : null,
            col === "companies" ? h("span", { text: fmtVal("companies", r, "type", r.type || "client") }) : null, col === "contacts" && r.position ? h("span", { text: r.position }) : null,
            col === "leads" ? leadTag(r.status) : null)));
      body.replaceChildren(
        r.deleted ? h("div", { class: "crm-deleted" }, h("span", { text: "🗑️ This record is in the recycle bin." }), h("button", { class: "btn", text: "Restore", onclick: () => restore(col, id) })) : null,
        head,
        col === "deals" || col === "items" ? stageBar(col, r) : null,
        col === "leads" && r.status !== "converted" ? h("button", { class: "btn primary crm-convert", text: "🔁 Convert to contact + deal", onclick: () => convert(r) }) : null,
        h("div", { class: "crm-sec glass" }, h("div", { class: "crm-sec-h", text: "About" }), infoGrid(col, r), r.notes ? h("div", { class: "crm-notes", text: r.notes }) : null),
        col === "deals" ? h("div", { class: "crm-sec glass" }, h("div", { class: "crm-sec-h", text: "Products" }), prodBox) : null,
        col === "deals" ? h("div", { class: "crm-sec glass" }, h("div", { class: "crm-sec-h", text: "Estimates & invoices" }), dealDocs(r)) : null,
        rel.length ? h("div", { class: "crm-sec glass" }, h("div", { class: "crm-sec-h", text: "Related" }), ...rel) : null,
        h("div", { class: "td-sec", text: "Activity" }),
        comp,
        open.length ? h("div", { class: "crm-open" }, h("div", { class: "crm-open-h", text: `Planned (${open.length})` }), ...open.map(a => h("div", { class: "crm-open-r" + (late(a) ? " late" : "") },
          h("input", { type: "checkbox", title: "Mark done", onchange: () => markDone(a) }),
          h("span", { class: "crm-open-ic", text: ATYPES[a.type]?.[0] || "📌" }),
          h("span", { class: "crm-open-t" }, h("b", { text: a.subject || ATYPES[a.type]?.[1] }), h("small", { text: when(a.due) + (a.owner !== me() ? " · " + Data.person(a.owner).name : "") })),
          a.owner && a.owner !== me() ? Apps.avatar(Data.person(a.owner), 20) : null,
          h("button", { class: "icon-btn xs", title: "Delete", html: UI.icon("x"), onclick: async () => { if (await UI.confirm("Delete this activity?")) Data.remove("activities", a.id); } })))) : null,
        timeline(col, r));
    }
    draw(); ready = true;
    return p;
  }

  /* ---------- shared view pieces ---------- */
  // kanban board for deals (stages of one pipeline) and smart-process items
  function board(col, stages, rows, opts = {}) {
    return h("div", { class: "board crm-board" }, ...stages.map((s, i) => {
      const items = rows.filter(r => stageOf(col, r).id === s.id), total = sum(items);
      const colEl = h("div", { class: "b-col crm-col" + (s.sem !== "process" ? " closed" : ""), style: { "--sc": `var(--c-${s.color || "gray"})`, animationDelay: i * 40 + "ms" } },
        h("div", { class: "b-col-h crm-col-h" }, h("span", { class: "crm-col-n", text: s.name }), h("span", { class: "n", text: items.length }), h("span", { class: "grow" }),
          h("small", { class: "sum", text: col === "items" && !total ? "" : Apps.money(total) })),
        h("div", { class: "b-cards" }, ...items.map(r => card(col, r, true)), items.length ? null : h("div", { class: "crm-col-empty", text: s.sem === "process" ? "Drop here" : s.sem === "won" ? "🏆 Drop won ones here" : "Drop lost ones here" })),
        h("button", { class: "b-add", text: "+ " + (opts.addLabel || "Add"), onclick: () => opts.onAdd?.(s) }));
      colEl.addEventListener("dragover", e => { e.preventDefault(); colEl.classList.add("drop"); });
      colEl.addEventListener("dragleave", e => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drop"); });
      colEl.addEventListener("drop", e => {
        e.preventDefault(); colEl.classList.remove("drop");
        const [c, id] = String(e.dataTransfer.getData("text/crm") || "").split(":");
        if (c === col) setStage(col, Data.get(col, id), s.id);
      });
      return colEl;
    }));
  }
  function card(col, r, drag) {
    const nx = NX.get(col + ":" + r.id), over = late(nx);
    const sub = col === "deals" ? [name("companies", r.company) && "🏢 " + name("companies", r.company), name("contacts", r.contact) && "👤 " + name("contacts", r.contact)].filter(Boolean)
      : col === "leads" ? [r.companyName && "🏢 " + r.companyName, r.source].filter(Boolean) : [];
    const closeLate = col === "deals" && r.close && r.close < Apps.today() && isOpenDeal(r);
    const el = h("div", { class: "b-card crm-card" + (over ? " late" : ""), draggable: !!drag, onclick: () => openRecord(col, r.id) },
      h("div", { class: "bc-t" }, over ? h("i", { class: "crm-dot", title: "Overdue activity" }) : null, recName(r)),
      col === "deals" || amt(r) ? h("div", { class: "deal-amt", text: Apps.money(r.amount) }) : null,
      sub.length ? h("div", { class: "crm-card-sub", text: sub.join(" · ") }) : null,
      nextChip(nx, false),
      h("div", { class: "bc-p" }, col === "deals" && r.close ? h("span", { class: "dl" + (closeLate ? " overdue" : ""), text: "⏱ " + Apps.fmtDate(r.close) }) : null,
        h("span", { class: "grow" }), r.owner ? Apps.avatar(Data.person(r.owner), 22) : null));
    if (drag) {
      el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/crm", col + ":" + r.id); el.classList.add("dragging"); });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
    }
    return el;
  }
  const whoCell = r => r.owner ? h("span", { class: "who" }, Apps.avatar(Data.person(r.owner), 20), h("span", { class: "tt", text: Data.person(r.owner).name })) : h("span", { text: "—" });
  const nameCell = (col, r, extra) => { const nx = NX.get(col + ":" + r.id); return h("span", { class: "crm-name" }, late(nx) ? h("i", { class: "crm-dot", title: "Overdue activity" }) : null, h("b", { class: "tt", text: recName(r) }), extra ? h("small", { text: extra }) : null); };

  /* ---------- CSV ---------- */
  const csvCell = v => { v = v == null ? "" : String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    const first = text.split(/\r?\n/)[0] || "", n = ch => (first.match(new RegExp(ch === "\t" ? "\\t" : ch, "g")) || []).length;
    const delim = n(";") > n(",") && n(";") >= n("\t") ? ";" : n("\t") > n(",") ? "\t" : ",";
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === "") q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ""));
  }
  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function ioCols(col) {
    const L = (k, l, x = {}) => ({ k, l, ...x });
    const base = {
      deals: [L("title", "Deal name"), L("amount", "Amount", { num: 1 }), L("pipeline", "Pipeline", { out: d => pipeline(d.pipeline).name }), L("stage", "Stage", { out: d => dStage(d).name }),
        L("contact", "Contact", { out: d => name("contacts", d.contact) }), L("company", "Company", { out: d => name("companies", d.company) }), L("owner", "Responsible", { out: r => personOut(r.owner) }),
        L("close", "Expected close"), L("closeReason", "Close reason"), L("notes", "Notes")],
      leads: [L("name", "Lead name"), L("companyName", "Company"), L("source", "Source"), L("email", "Email"), L("phone", "Phone"), L("status", "Status", { out: r => fmtVal("leads", r, "status", r.status || "new") }),
        L("owner", "Responsible", { out: r => personOut(r.owner) }), L("value", "Potential value", { num: 1 }), L("notes", "Notes")],
      contacts: [L("name", "Full name"), L("position", "Position"), L("company", "Company", { out: r => name("companies", r.company) }), L("email", "Email"), L("phone", "Phone"), L("owner", "Responsible", { out: r => personOut(r.owner) }), L("notes", "Notes")],
      companies: [L("name", "Company name"), L("type", "Type", { out: r => fmtVal("companies", r, "type", r.type || "client") }), L("industry", "Industry"), L("size", "Employees"), L("website", "Website"), L("phone", "Phone"), L("email", "Email"),
        L("owner", "Responsible", { out: r => personOut(r.owner) }), L("notes", "Notes")],
    }[col];
    return [...base, ...fieldsFor(col).map(f => L("cf:" + f.key, f.label, { cf: f })), L("at", "Created", { out: r => r.at ? Apps.iso(new Date(r.at)) : "", noImport: true })];
  }
  function exportCsv(col, rows) {
    const cols = ioCols(col);
    const out = [cols.map(c => c.l), ...rows.map(r => cols.map(c => {
      if (c.out) return c.out(r);
      if (c.cf) { const v = (r.custom || {})[c.cf.key]; return c.cf.type === "checkbox" ? (v ? "Yes" : "No") : v ?? ""; }
      return r[c.k] ?? "";
    }))];
    download(`lumen-${col}-${Apps.today()}.csv`, toCsv(out));
    UI.toast(`⬇️ Exported ${rows.length} ${rows.length === 1 ? LABEL[col] : PLURAL[col]}`);
  }
  const norm = s => low(s).replace(/[^a-z0-9]/g, "");
  const SYN = { email: ["email", "e-mail", "mail", "emailaddress"], phone: ["phone", "telephone", "tel", "mobile", "phonenumber", "cell"], name: ["name", "fullname", "contact", "contactname", "leadname", "companyname", "company name"],
    title: ["title", "deal", "dealname", "name", "subject"], companyName: ["company", "organization", "organisation", "account"], company: ["company", "organization", "organisation", "account", "companyname"],
    owner: ["owner", "responsible", "assignedto", "manager", "salesrep"], amount: ["amount", "value", "sum", "price", "dealvalue"], value: ["value", "amount", "potentialvalue", "budget"], notes: ["notes", "note", "comment", "comments", "description"],
    close: ["close", "closedate", "expectedclose", "closingdate"], website: ["website", "url", "site", "web", "homepage"], position: ["position", "jobtitle", "role"], source: ["source", "leadsource", "channel"] };
  function autoMatch(header, specs, used) {
    const n = norm(header);
    const hit = specs.find(s => !used.has(s.k) && (norm(s.l) === n || norm(s.k) === n)) || specs.find(s => !used.has(s.k) && (SYN[s.k] || []).map(norm).includes(n));
    if (hit) used.add(hit.k);
    return hit ? hit.k : "";
  }
  function importCsv(col, ctx = {}) {
    Apps.pickFiles(false).then(async files => {
      const file = files[0]; if (!file) return;
      let rows; try { rows = parseCsv(await file.text()); } catch { return UI.toast("Couldn't read that file"); }
      if (rows.length < 2) return UI.toast("That file has no rows to import");
      const head = rows[0], data = rows.slice(1), specs = ioCols(col).filter(s => !s.noImport), used = new Set();
      const map = head.map(hd => autoMatch(hd, specs, used));
      const hasEmail = specs.some(s => s.k === "email");
      let dedupe = true;
      const mapBox = h("div", { class: "crm-map" }), prev = h("div", { class: "crm-prev" }), go = h("button", { class: "btn primary" });
      const paint = () => {
        mapBox.replaceChildren(h("div", { class: "crm-map-r head" }, h("span", { text: "Column in file" }), h("span", { text: "Example" }), h("span", { text: "Save as" })),
          ...head.map((hd, i) => h("div", { class: "crm-map-r" }, h("b", { text: hd || `Column ${i + 1}` }), h("small", { text: data.find(r => r[i])?.[i] || "—" }),
            h("select", { class: "chip-in", onchange: e => { map[i] = e.target.value; paint(); } }, h("option", { value: "" }, "— Skip —"),
              ...specs.map(s => h("option", { value: s.k, selected: map[i] === s.k, disabled: map[i] !== s.k && map.includes(s.k) }, s.l))))));
        const cols = map.map((k, i) => [k, i]).filter(x => x[0]);
        prev.replaceChildren(cols.length ? h("div", { class: "crm-prev-t", style: { gridTemplateColumns: `repeat(${cols.length}, minmax(110px, 1fr))` } },
          ...cols.map(([k]) => h("b", { text: specs.find(s => s.k === k)?.l || k })), ...data.slice(0, 5).flatMap(r => cols.map(([, i]) => h("span", { text: r[i] || "" }))))
          : h("div", { class: "crm-hint", text: "Choose at least one column to import." }));
        go.textContent = `Import ${data.length} ${data.length === 1 ? LABEL[col] : PLURAL[col]}`;
        go.disabled = !cols.length;
      };
      go.onclick = async () => {
        const n = await runImport(col, head, data, map, specs, dedupe, ctx);
        m.close();
        UI.toast(`⬆️ Imported ${n.added} ${n.added === 1 ? LABEL[col] : PLURAL[col]}${n.skipped ? ` · skipped ${n.skipped} duplicate${n.skipped > 1 ? "s" : ""}` : ""}`);
      };
      const m = UI.modal("Import " + PLURAL[col] + " from CSV", h("div", { class: "crm-import" },
        h("p", { class: "crm-hint", text: `${data.length} row${data.length > 1 ? "s" : ""} in “${file.name}”. Check how the columns map to fields.` }),
        mapBox,
        h("label", { class: "crm-check" }, h("input", { type: "checkbox", checked: true, onchange: e => { dedupe = e.target.checked; } }), h("span", { text: hasEmail ? "Skip rows whose email already exists" : "Skip rows whose name already exists" })),
        h("div", { class: "td-sec", text: "Preview (first 5 rows)" }), prev,
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), go))));
      m.el.style.width = "720px";
      paint();
    });
  }
  async function runImport(col, head, data, map, specs, dedupe, ctx) {
    const people = Data.people(), pid = ctx.pipeline || "default", made = { companies: {}, contacts: {} };
    const existing = new Set(live(col).map(r => low(specs.some(s => s.k === "email") ? r.email : r.name)).filter(Boolean));
    const num = v => { const x = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")); return isNaN(x) ? 0 : x; };
    async function ref(c, nm) {
      nm = String(nm || "").trim(); if (!nm) return "";
      const hit = live(c).find(x => low(x.name) === low(nm)); if (hit) return hit.id;
      if (made[c][low(nm)]) return made[c][low(nm)];
      return (made[c][low(nm)] = await Data.add(c, { name: nm, owner: me(), activities: [], ...(c === "companies" ? { type: "client" } : {}) }));
    }
    let added = 0, skipped = 0;
    await quietly(async () => {
      for (const row of data) {
        const rec = { activities: [], owner: me() }, custom = {}, val = k => { const i = map.indexOf(k); return i < 0 ? undefined : String(row[i] ?? "").trim(); };
        for (const s of specs) {
          const v = val(s.k); if (v === undefined || v === "") continue;
          if (s.cf) { custom[s.cf.key] = s.cf.type === "checkbox" ? /^(yes|true|1|y|x|✓)$/i.test(v) : s.cf.type === "number" ? num(v) : v; continue; }
          if (s.num) rec[s.k] = num(v);
          else if (s.k === "owner") rec.owner = (people.find(p => low(p.email) === low(v) || low(p.name) === low(v)) || {}).key || me();
          else if (s.k === "company" && col !== "companies") rec.company = await ref("companies", v);
          else if (s.k === "contact") rec.contact = await ref("contacts", v);
          else if (s.k === "status") rec.status = (LEAD_ST.find(x => low(x[1]) === low(v) || x[0] === low(v)) || LEAD_ST[0])[0];
          else if (s.k === "type") rec.type = (CTYPES.find(x => low(x[1]) === low(v) || x[0] === low(v)) || CTYPES[0])[0];
          else if (s.k !== "pipeline" && s.k !== "stage") rec[s.k] = v;
        }
        if (Object.keys(custom).length) rec.custom = custom;
        if (col === "deals") {
          const pv = val("pipeline"), p = pv ? pipelines().find(x => low(x.name) === low(pv) || x.id === pv) : null;
          rec.pipeline = (p || pipeline(pid)).id;
          const sv = val("stage"), ss = stagesFor(rec.pipeline), s = sv ? ss.find(x => low(x.name) === low(sv) || x.id === sv) : null;
          rec.stage = (s || ss[0])?.id || "new";
          if (s && s.sem !== "process") rec.closedAt = Date.now();
          if (!rec.title) continue;
        } else if (!rec.name) continue;
        if (col === "companies" && !rec.type) rec.type = "client";
        if (col === "leads" && !rec.status) rec.status = "new";
        const key = low(specs.some(s => s.k === "email") ? rec.email : rec.name);
        if (dedupe && key && existing.has(key)) { skipped++; continue; }
        if (key) existing.add(key);
        await Data.add(col, rec);
        added++;
      }
    });
    if (added) Data.add("history", { col, id: "import", action: "created", fields: { imported: [0, added] }, title: `Imported ${added} ${PLURAL[col]} from CSV` });
    return { added, skipped };
  }

  /* ---------- settings editors ---------- */
  function colorMenu(anchor, onPick) {
    UI.menu(anchor, COLORS.map(c => ({ label: cap(c), iconHtml: `<span class="crm-sw" style="background:var(--c-${c})"></span>`, onClick: () => onPick(c) })));
  }
  // editable list of stages (drag to reorder); mutates `stages` and calls repaint() after changes
  function stageEditor(stages, repaint, onDelete) {
    let from = -1;
    const rows = stages.map((s, i) => {
      const grip = h("span", { class: "crm-grip", title: "Drag to reorder", html: UI.icon("drag") });
      const row = h("div", { class: "crm-stage-r", style: { "--sc": `var(--c-${s.color || "gray"})` } },
        grip,
        h("button", { type: "button", class: "crm-swatch", title: "Color", onclick: e => colorMenu(e.currentTarget, c => { s.color = c; repaint(); }) }),
        h("input", { class: "menu-input", value: s.name || "", placeholder: "Stage name", maxlength: 40, oninput: e => { s.name = e.target.value; } }),
        h("select", { class: "chip-in", title: "Kind of stage", onchange: e => { s.sem = e.target.value; repaint(); } }, ...SEMS.map(([k, l]) => h("option", { value: k, selected: (s.sem || "process") === k }, l))),
        h("button", { type: "button", class: "icon-btn xs", title: "Delete stage", html: UI.icon("trash"), onclick: () => onDelete(s, i) }));
      const arm = () => row.setAttribute("draggable", "true");
      grip.addEventListener("mousedown", arm); grip.addEventListener("touchstart", arm, { passive: true }); grip.addEventListener("pointerdown", arm);
      row.addEventListener("dragstart", e => { from = i; e.dataTransfer.setData("text/crm-stage", String(i)); row.classList.add("dragging"); });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); row.setAttribute("draggable", "false"); });
      row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("over"); });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", e => {
        e.preventDefault(); row.classList.remove("over");
        const f = from >= 0 ? from : +e.dataTransfer.getData("text/crm-stage"); from = -1;
        if (isNaN(f) || f === i) return;
        const [mv] = stages.splice(f, 1); stages.splice(i, 0, mv); repaint();
      });
      return row;
    });
    return h("div", { class: "crm-stages" }, ...rows,
      h("button", { type: "button", class: "chip-btn crm-add-st", text: "+ Add stage", onclick: () => {
        const at = stages.findIndex(s => s.sem && s.sem !== "process");
        stages.splice(at < 0 ? stages.length : at, 0, { id: "s" + uid(), name: "New stage", color: COLORS[(stages.length + 1) % COLORS.length], sem: "process" });
        repaint();
      } }));
  }
  function pickStage(title, msg, options) {
    return new Promise(res => {
      let done = false;
      const sel = h("select", { class: "menu-input" }, ...options.map(([v, l]) => h("option", { value: v }, l)));
      const m = UI.modal(title, h("div", { class: "crm-reason" }, h("p", { text: msg }), sel,
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }),
          h("button", { class: "btn primary", text: "Move and delete", onclick: () => { done = true; m.close(); res(sel.value); } })))), { onClose: () => !done && res(null) });
      m.el.style.width = "440px";
    });
  }
  function configurePipelines(startId) {
    const work = JSON.parse(JSON.stringify(pipelines())), moves = [];
    let cur = Math.max(0, work.findIndex(p => p.id === startId));
    const box = h("div", { class: "crm-cfg" });
    // where each deal will end up once the pending moves are applied
    const virt = d => { let p = pipeline(d.pipeline).id, s = d.stage; moves.forEach(mv => { if (mv.pipe === p && (mv.from == null || mv.from === s)) { p = mv.toPipe; s = mv.to; } }); return [p, s]; };
    const dealsAt = (pid, sid) => Data.list("deals").filter(d => { const [p, s] = virt(d); return p === pid && (sid == null || s === sid); });
    function paint() {
      const P = work[cur];
      box.replaceChildren(
        h("div", { class: "crm-pipes" }, ...work.map((p, i) => h("button", { type: "button", class: "crm-pipe-tab" + (i === cur ? " on" : ""), text: p.name || "Untitled", onclick: () => { cur = i; paint(); } })),
          h("button", { type: "button", class: "crm-pipe-tab add", text: "+ New pipeline", onclick: () => {
            work.push({ id: "p" + uid(), name: "New pipeline", stages: [["New", "blue", "process"], ["In progress", "orange", "process"], ["Won", "green", "won"], ["Lost", "red", "lost"]].map(([n, c, s]) => ({ id: "s" + uid(), name: n, color: c, sem: s })) });
            cur = work.length - 1; paint();
          } })),
        h("div", { class: "crm-cfg-row" }, h("label", { class: "f-row" }, h("span", { text: "Pipeline name" }), h("input", { class: "menu-input", value: P.name || "", maxlength: 50, oninput: e => { P.name = e.target.value; box.querySelector(".crm-pipe-tab.on").textContent = e.target.value || "Untitled"; } })),
          P.id !== "default" ? h("button", { type: "button", class: "btn danger", text: "Delete pipeline", onclick: async () => {
            const n = dealsAt(P.id).length, rest = work.filter(p => p !== P);
            if (n) {
              const to = await pickStage("Delete “" + P.name + "”", `${n} deal${n > 1 ? "s are" : " is"} in this pipeline. Move ${n > 1 ? "them" : "it"} to:`, rest.map(p => [p.id, p.name]));
              if (!to) return;
              const first = (rest.find(p => p.id === to).stages || []).find(s => s.sem === "process") || rest.find(p => p.id === to).stages[0];
              moves.push({ pipe: P.id, from: null, toPipe: to, to: first?.id });
            } else if (!(await UI.confirm("Delete the pipeline “" + P.name + "”?"))) return;
            work.splice(cur, 1); cur = 0; paint();
          } }) : h("small", { class: "crm-hint", text: "The default pipeline can be renamed but not deleted." })),
        h("div", { class: "td-sec", text: "Stages" }),
        h("p", { class: "crm-hint", text: "Drag to reorder. Mark the stages that close a deal as Won or Lost." }),
        stageEditor(P.stages, paint, async (s, i) => {
          if (P.stages.length <= 1) return UI.toast("A pipeline needs at least one stage");
          const n = dealsAt(P.id, s.id).length;
          if (n) {
            const to = await pickStage("Delete “" + s.name + "”", `${n} deal${n > 1 ? "s are" : " is"} in this stage. Move ${n > 1 ? "them" : "it"} to:`, P.stages.filter(x => x !== s).map(x => [x.id, x.name]));
            if (!to) return;
            moves.push({ pipe: P.id, from: s.id, toPipe: P.id, to });
          }
          P.stages.splice(P.stages.indexOf(s), 1); paint();
        }),
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { class: "btn primary", text: "Save", onclick: save }))));
    }
    async function save() {
      for (const p of work) {
        p.name = String(p.name || "").trim() || "Untitled pipeline";
        p.stages = (p.stages || []).map(s => ({ id: s.id, name: String(s.name || "").trim() || "Stage", color: s.color || "gray", sem: s.sem || "process" }));
        if (!p.stages.length) return UI.toast(`“${p.name}” needs at least one stage`);
      }
      if (!work.some(p => p.id === "default")) return UI.toast("The default pipeline can't be removed");
      await quietly(async () => {
        Data.list("deals").forEach(d => {
          const [p, s] = virt(d), P = work.find(x => x.id === p) || work[0], st = P.stages.find(x => x.id === s) || P.stages.find(x => x.sem === "process") || P.stages[0];
          if (P.id !== (d.pipeline || "default") || st.id !== d.stage) Data.update("deals", d.id, { pipeline: P.id, stage: st.id });
        });
      });
      await saveCfg({ pipelines: work });
      m.close(); UI.toast("✅ Pipelines saved");
    }
    const m = UI.modal("Pipelines & stages", box);
    m.el.style.width = "640px"; m.el.classList.add("crm-cfg-modal");
    paint();
  }
  // custom fields editor; mutates `list`
  function fieldsEditor(list, repaint) {
    const TYPES = [["text", "Text"], ["number", "Number"], ["date", "Date"], ["select", "List"], ["checkbox", "Yes / no"], ["url", "Link"]];
    return h("div", { class: "crm-fields" },
      ...list.map((f, i) => h("div", { class: "crm-field-r" },
        h("input", { class: "menu-input", placeholder: "Field name", value: f.label || "", maxlength: 40, oninput: e => { f.label = e.target.value; } }),
        h("select", { class: "chip-in", onchange: e => { f.type = e.target.value; repaint(); } }, ...TYPES.map(([k, l]) => h("option", { value: k, selected: (f.type || "text") === k }, l))),
        f.type === "select" ? h("input", { class: "menu-input crm-opts", placeholder: "Options, separated by commas", value: (f.options || []).join(", "), oninput: e => { f.options = e.target.value.split(",").map(x => x.trim()).filter(Boolean); } }) : h("span", { class: "crm-opts" }),
        h("span", { class: "crm-field-acts" },
          h("button", { type: "button", class: "icon-btn xs", title: "Move up", text: "↑", disabled: !i, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); repaint(); } }),
          h("button", { type: "button", class: "icon-btn xs", title: "Delete field", html: UI.icon("trash"), onclick: () => { list.splice(i, 1); repaint(); } })))),
      list.length ? null : h("div", { class: "crm-hint", text: "No custom fields yet." }),
      h("button", { type: "button", class: "chip-btn", text: "+ Add field", onclick: () => { list.push({ key: "", label: "", type: "text" }); repaint(); setTimeout(() => [...document.querySelectorAll(".crm-field-r input")].pop()?.focus(), 30); } }));
  }
  const slug = s => (low(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "field") + "_" + uid().slice(0, 3);
  const cleanFields = list => list.filter(f => String(f.label || "").trim()).map(f => ({ key: f.key || slug(f.label), label: f.label.trim(), type: f.type || "text", ...(f.type === "select" ? { options: f.options || [] } : {}) }));
  function configureFields(col) {
    const list = JSON.parse(JSON.stringify(fieldsFor(col)));
    const box = h("div", { class: "crm-cfg" });
    const paint = () => box.replaceChildren(h("p", { class: "crm-hint", text: `Extra fields appear in the ${LABEL[col]} form and card, and are searchable and exported.` }), fieldsEditor(list, paint),
      h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }),
        h("button", { class: "btn primary", text: "Save", onclick: async () => { await saveCfg({ fields: { ...(cfg().fields || {}), [col]: cleanFields(list) } }); m.close(); UI.toast("✅ Fields saved"); } }))));
    const m = UI.modal("Fields · " + cap(PLURAL[col]), box);
    m.el.style.width = "640px"; m.el.classList.add("crm-cfg-modal");
    paint();
  }
  function editSmart(type, onSaved) {
    const isNew = !type;
    const t = JSON.parse(JSON.stringify(type || { id: "t" + uid(), name: "", icon: "🧩", stages: [["New", "blue", "process"], ["In progress", "orange", "process"], ["Done", "green", "won"], ["Cancelled", "red", "lost"]].map(([n, c, s]) => ({ id: "s" + uid(), name: n, color: c, sem: s })), fields: [] }));
    const moves = {};
    const box = h("div", { class: "crm-cfg" });
    const paint = () => box.replaceChildren(
      h("div", { class: "crm-cfg-row" },
        h("label", { class: "f-row crm-icon-f" }, h("span", { text: "Icon" }), h("input", { class: "menu-input", value: t.icon || "", maxlength: 4, oninput: e => { t.icon = e.target.value; } })),
        h("label", { class: "f-row" }, h("span", { text: "Name" }), h("input", { class: "menu-input", value: t.name || "", placeholder: "e.g. Projects, Contracts, Repairs", maxlength: 40, oninput: e => { t.name = e.target.value; } }))),
      h("div", { class: "td-sec", text: "Stages" }),
      stageEditor(t.stages, paint, async (s) => {
        if (t.stages.length <= 1) return UI.toast("A process needs at least one stage");
        const n = Data.list("items").filter(x => x.type === t.id && (moves[x.stage] || x.stage) === s.id).length;
        if (n) {
          const to = await pickStage("Delete “" + s.name + "”", `${n} item${n > 1 ? "s are" : " is"} in this stage. Move ${n > 1 ? "them" : "it"} to:`, t.stages.filter(x => x !== s).map(x => [x.id, x.name]));
          if (!to) return;
          Object.keys(moves).forEach(k => { if (moves[k] === s.id) moves[k] = to; }); moves[s.id] = to;
        }
        t.stages.splice(t.stages.indexOf(s), 1); paint();
      }),
      h("div", { class: "td-sec", text: "Fields" }),
      fieldsEditor(t.fields, paint),
      h("div", { class: "f-actions" },
        isNew ? h("span") : h("button", { type: "button", class: "btn danger", text: "Delete process", onclick: async () => {
          const n = Data.list("items").filter(x => x.type === t.id && !x.deleted).length;
          if (!(await UI.confirm(`Delete “${t.name}”?${n ? ` Its ${n} item${n > 1 ? "s" : ""} move to the recycle bin.` : ""}`))) return;
          await quietly(() => Data.list("items").filter(x => x.type === t.id && !x.deleted).forEach(x => Data.update("items", x.id, { deleted: true, deletedAt: Date.now(), deletedBy: me() })));
          await saveCfg({ smart: smartTypes().filter(x => x.id !== t.id) }); m.close(); onSaved?.(null);
        } }),
        h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { class: "btn primary", text: isNew ? "Create" : "Save", onclick: async () => {
          t.name = String(t.name || "").trim(); if (!t.name) return UI.toast("Give the process a name");
          t.icon = String(t.icon || "").trim() || "🧩";
          t.stages = t.stages.map(s => ({ id: s.id, name: String(s.name || "").trim() || "Stage", color: s.color || "gray", sem: s.sem || "process" }));
          t.fields = cleanFields(t.fields);
          await quietly(() => Data.list("items").filter(x => x.type === t.id && moves[x.stage]).forEach(x => Data.update("items", x.id, { stage: moves[x.stage] })));
          const all = smartTypes(), i = all.findIndex(x => x.id === t.id);
          if (i < 0) all.push(t); else all[i] = t;
          await saveCfg({ smart: all }); m.close(); UI.toast(isNew ? "✨ " + t.name + " created" : "✅ Saved"); onSaved?.(t.id);
        } }))));
    const m = UI.modal(isNew ? "New smart process" : "Edit " + type.name, box);
    m.el.style.width = "640px"; m.el.classList.add("crm-cfg-modal");
    paint();
  }
  function configureSmart(onPick) {
    const box = h("div", { class: "crm-cfg" });
    const paint = () => {
      const all = smartTypes();
      box.replaceChildren(h("p", { class: "crm-hint", text: "Smart processes are your own record types with their own stages and fields: projects, contracts, repairs, anything. Each one gets a tab in the CRM." }),
        all.length ? h("div", { class: "crm-smart-list" }, ...all.map(t => h("div", { class: "crm-smart-r glass" },
          h("span", { class: "crm-smart-ic", text: t.icon || "🧩" }), h("span", { class: "crm-smart-t" }, h("b", { text: t.name }), h("small", { text: `${(t.stages || []).length} stages · ${(t.fields || []).length} fields · ${live("items").filter(x => x.type === t.id).length} items` })),
          h("button", { class: "btn", text: "Open", onclick: () => { m.close(); onPick?.(t.id); } }),
          h("button", { class: "btn", text: "Edit", onclick: () => editSmart(t, paint) })))) : Apps.empty("🧩", "No smart processes yet."),
        h("div", { class: "f-actions" }, h("span"), h("button", { class: "btn primary", text: "+ New smart process", onclick: () => editSmart(null, id => { paint(); if (id) { m.close(); onPick?.(id); } }) })));
    };
    const m = UI.modal("Smart processes", box);
    m.el.style.width = "600px";
    paint();
  }

  /* ---------- analytics ---------- */
  const months = n => { const out = [], d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setMonth(d.getMonth() - i); out.push(x); } return out; };
  function donut(parts, label, sub) {
    const total = parts.reduce((a, p) => a + p.v, 0), R = 42, C = 2 * Math.PI * R;
    let off = 0;
    const segs = total ? parts.filter(p => p.v).map(p => { const len = p.v / total * C, s = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${p.c}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" stroke-linecap="butt"/>`; off += len; return s; }).join("") : "";
    return h("div", { class: "crm-donut" }, h("div", { class: "crm-donut-svg", html: `<svg viewBox="0 0 120 120" width="132" height="132"><circle r="${R}" cx="60" cy="60" fill="none" stroke="var(--hover)" stroke-width="14"/><g transform="rotate(-90 60 60)">${segs}</g></svg>` },
      h("div", { class: "crm-donut-c" }, h("b", { text: label }), h("small", { text: sub }))));
  }
  function analytics(pid) {
    const deals = live("deals"), leads = live("leads"), P = pipeline(pid), stages = P.stages || [];
    const inPipe = deals.filter(d => pipeOf(d) === P.id);
    const order = [...stages.filter(s => s.sem === "process"), ...stages.filter(s => s.sem === "won")];
    // furthest stage a lost deal reached, from the stage history (newest 400 history docs)
    const lostFrom = {};
    Data.list("history").filter(x => x.col === "deals" && x.action === "stage" && x.fields?.stage).sort((a, b) => (a.at || 0) - (b.at || 0)).forEach(x => {
      const nw = stages.find(s => s.id === x.fields.stage[1]); if (nw && nw.sem === "lost") lostFrom[x.id] = x.fields.stage[0];
    });
    const idxOf = d => { const s = dStage(d); if (s.sem === "won") return order.length - 1; if (s.sem === "lost") return Math.max(0, order.findIndex(o => o.id === lostFrom[d.id])); return Math.max(0, order.findIndex(o => o.id === s.id)); };
    const reached = order.map((s, i) => inPipe.filter(d => idxOf(d) >= i)), top = Math.max(1, reached[0]?.length || 0);
    const funnel = h("div", { class: "report glass crm-rep crm-funnel" }, h("h3", null, "Sales funnel ", h("small", { text: P.name })),
      order.length ? h("div", { class: "crm-fun" }, ...order.map((s, i) => {
        const n = reached[i].length, conv = i ? (reached[i - 1].length ? Math.round(n / reached[i - 1].length * 100) : 0) : null;
        return h("div", { class: "crm-fun-r", style: { animationDelay: i * 50 + "ms" } },
          h("span", { class: "crm-fun-l", text: s.name }),
          h("div", { class: "crm-fun-bar" }, h("span", { style: { width: Math.max(6, n / top * 100) + "%", background: `var(--c-${s.color || "gray"})` } }, h("b", { text: n }))),
          h("span", { class: "crm-fun-v", text: Apps.money(sum(reached[i])) }),
          h("small", { class: "crm-fun-c", text: conv == null ? "" : conv + "%", title: "Conversion from the previous stage" }));
      })) : Apps.empty("📉", "No stages yet."),
      h("div", { class: "crm-fun-foot" }, ...stages.filter(s => s.sem === "lost").map(s => { const l = inPipe.filter(d => d.stage === s.id); return h("span", null, tagEl(s.name, s.color), ` ${l.length} · ${Apps.money(sum(l))}`); })));
    // won vs lost this month
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const closedAt = d => d.closedAt || d.at || 0;
    const wonM = deals.filter(d => dStage(d).sem === "won" && closedAt(d) >= m0.getTime()), lostM = deals.filter(d => dStage(d).sem === "lost" && closedAt(d) >= m0.getTime());
    const rate = wonM.length + lostM.length ? Math.round(wonM.length / (wonM.length + lostM.length) * 100) : 0;
    const wl = h("div", { class: "report glass crm-rep" }, h("h3", { text: "Won vs lost this month" }),
      h("div", { class: "crm-wl" }, donut([{ v: wonM.length, c: "var(--c-green)" }, { v: lostM.length, c: "var(--c-red)" }], rate + "%", "win rate"),
        h("div", { class: "crm-wl-legend" },
          h("div", null, h("i", { style: { background: "var(--c-green)" } }), h("span", { text: "Won" }), h("b", { text: wonM.length }), h("small", { text: Apps.money(sum(wonM)) })),
          h("div", null, h("i", { style: { background: "var(--c-red)" } }), h("span", { text: "Lost" }), h("b", { text: lostM.length }), h("small", { text: Apps.money(sum(lostM)) })))));
    // revenue by month
    const ms = months(6), rev = ms.map(d => { const a = d.getTime(), b = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); return sum(deals.filter(x => dStage(x).sem === "won" && closedAt(x) >= a && closedAt(x) < b)); });
    const maxRev = Math.max(1, ...rev);
    const revenue = h("div", { class: "report glass crm-rep" }, h("h3", null, "Revenue by month ", h("small", { text: "won deals, all pipelines" })),
      h("div", { class: "crm-cols" }, ...ms.map((d, i) => h("div", { class: "crm-colbar" + (i === ms.length - 1 ? " now" : ""), title: Apps.money(rev[i]) },
        h("small", { class: "crm-colbar-v", text: rev[i] ? Apps.money(rev[i]) : "" }),
        h("div", { class: "crm-colbar-t" }, h("span", { style: { height: Math.max(rev[i] ? 4 : 0, rev[i] / maxRev * 100) + "%", animationDelay: i * 60 + "ms" } })),
        h("small", { text: d.toLocaleDateString(undefined, { month: "short" }) })))));
    // leaderboard
    const keys = [...new Set([...Data.people().map(p => p.key), ...deals.map(d => d.owner).filter(Boolean)])];
    const board2 = keys.map(k => { const mine = deals.filter(d => d.owner === k), won = mine.filter(d => dStage(d).sem === "won"); return { k, won: won.length, wonSum: sum(won), open: sum(mine.filter(isOpenDeal)), openN: mine.filter(isOpenDeal).length }; })
      .filter(x => x.won || x.openN).sort((a, b) => b.wonSum - a.wonSum || b.open - a.open);
    const maxW = Math.max(1, ...board2.map(x => x.wonSum));
    const leaders = h("div", { class: "report glass crm-rep" }, h("h3", { text: "Leaderboard" }),
      board2.length ? h("div", { class: "crm-lead" }, h("div", { class: "crm-lead-r head" }, h("span"), h("span", { text: "Person" }), h("span", { text: "Won" }), h("span", { text: "Open pipeline" })),
        ...board2.slice(0, 10).map((x, i) => h("div", { class: "crm-lead-r" },
          h("span", { class: "crm-medal", text: ["🥇", "🥈", "🥉"][i] || String(i + 1) }),
          h("span", { class: "who" }, Apps.avatar(Data.person(x.k), 24), h("span", { class: "crm-lead-n" }, h("span", { class: "tt", text: Data.person(x.k).name }), h("span", { class: "bar" }, h("span", { style: { width: x.wonSum / maxW * 100 + "%", background: "var(--c-green)" } })))),
          h("span", { class: "crm-lead-v" }, h("b", { text: Apps.money(x.wonSum) }), h("small", { text: x.won + " deal" + (x.won === 1 ? "" : "s") })),
          h("span", { class: "crm-lead-v" }, h("b", { text: Apps.money(x.open) }), h("small", { text: x.openN + " open" }))))) : Apps.empty("🏁", "No deals with a responsible person yet."));
    // lead sources
    const srcs = [...new Set([...SOURCES, ...leads.map(l => l.source || "Other")])].map((s, i) => { const ls2 = leads.filter(l => (l.source || "Other") === s); return { s, n: ls2.length, conv: ls2.filter(l => l.status === "converted").length, c: ["blue", "purple", "green", "orange", "pink", "yellow", "brown", "gray", "red"][i % 9] }; }).filter(x => x.n).sort((a, b) => b.n - a.n);
    const maxS = Math.max(1, ...srcs.map(x => x.n));
    const sources = h("div", { class: "report glass crm-rep" }, h("h3", { text: "Lead sources" }),
      srcs.length ? h("div", null, ...srcs.map(x => h("div", { class: "bar-row crm-src" }, h("span", { class: "tt", text: x.s }), h("div", { class: "bar" }, h("span", { style: { width: x.n / maxS * 100 + "%", background: `var(--c-${x.c})` } })),
        h("b", { text: `${x.n} · ${Math.round(x.n / leads.length * 100)}%`, title: `${x.conv} converted` })))) : Apps.empty("🧲", "No leads yet."));
    // deal cycle and averages
    const wonAll = deals.filter(d => dStage(d).sem === "won" && d.closedAt), lostAll = deals.filter(d => dStage(d).sem === "lost");
    const cycle = wonAll.length ? Math.round(wonAll.reduce((a, d) => a + Math.max(0, d.closedAt - (d.at || d.closedAt)), 0) / wonAll.length / DAY) : null;
    const wonDeals = deals.filter(d => dStage(d).sem === "won"), avgSize = wonDeals.length ? sum(wonDeals) / wonDeals.length : 0;
    const allRate = wonDeals.length + lostAll.length ? Math.round(wonDeals.length / (wonDeals.length + lostAll.length) * 100) : 0;
    const kpis = h("div", { class: "crm-summary crm-akpi" }, ...[["⏱️", "Average deal cycle", cycle == null ? "—" : cycle + (cycle === 1 ? " day" : " days"), wonAll.length ? `from creation to won · ${wonAll.length} deals` : "no won deals yet"],
      ["🎯", "Win rate", allRate + "%", `${wonDeals.length} won · ${lostAll.length} lost`], ["💰", "Average deal size", Apps.money(avgSize), "won deals"],
      ["📈", "Open pipeline", Apps.money(sum(deals.filter(isOpenDeal))), deals.filter(isOpenDeal).length + " open deals"]].map(([ic, l, v, s], i) =>
      h("div", { class: "kpi glass", style: { animationDelay: i * 60 + "ms" } }, h("span", { text: ic + " " + l }), h("b", { text: v }), h("small", { text: s }))));
    return h("div", { class: "crm-analytics" }, kpis, h("div", { class: "reports crm-reports" }, funnel, wl, revenue, leaders, sources));
  }

  /* ---------- main view ---------- */
  const DVIEWS = [["kanban", "Kanban"], ["list", "List"], ["activities", "Activities"], ["calendar", "Calendar"]];
  const EXT = ["products", "estimates", "invoices", "forms"];
  function render(root, arg) {
    startTicking();
    let tab = arg || ls.get("tab", "deals"), openAfter = null;
    if (/^open:/.test(tab)) { const [, c, id] = tab.split(":"); openAfter = [c, id]; tab = c === "items" ? "sp:" + (Data.get("items", id)?.type || "") : c; }
    if (tab === "reports") tab = "analytics";
    const st = { q: "", ctype: "all", sort: {}, sel: new Set(), month: (() => { const d = new Date(); d.setDate(1); return d; })(), selTab: "" };
    let ext = null, tabsSig = "", raf = 0;
    const t0 = Date.now();
    const summary = h("div", { class: "crm-summary" }), tabsBox = h("div", { class: "crm-tabs" }), tools = h("div", { class: "crm-tools" }), body = h("div", { class: "app-body crm-body" });
    const search = h("input", { class: "app-search", type: "search", placeholder: "Search…", oninput: e => { st.q = e.target.value.toLowerCase(); draw(); } });
    const addBtn = h("button", { class: "btn primary", onclick: () => add() });
    const cur = h("select", { class: "app-select", title: "Currency", onchange: e => { localStorage.setItem("lumen-currency", e.target.value); draw(); } }, ...["INR", "USD", "EUR", "GBP", "AED"].map(c => h("option", { value: c, selected: Apps.currency() === c }, c)));
    const more = h("button", { class: "icon-btn crm-more", title: "CRM settings", html: UI.icon("dots"), onclick: () => UI.menu(more, [
      { label: "Pipelines & stages…", iconHtml: "🛤️", onClick: () => configurePipelines(curPipe()) },
      { label: "Smart processes…", iconHtml: "🧩", onClick: () => configureSmart(id => setTab("sp:" + id)) },
      { section: "Custom fields" }, ...ENT.map(c => ({ label: cap(PLURAL[c]), iconHtml: ICON[c], onClick: () => configureFields(c) })),
      { sep: true }, { label: "Recycle bin", icon: "trash", onClick: () => setTab("bin") },
    ], { align: "end" }) });
    root.classList.add("crm-app");
    root.append(Apps.header("CRM", "💼", "Pipelines, leads, contacts, companies and sales", cur, more, addBtn), summary, tabsBox,
      h("div", { class: "app-toolbar crm-toolbar" }, tools), body);

    const curPipe = () => pipeline(ls.get("pipe", "default")).id;
    const dview = () => { const v = ls.get("dview", "kanban"); return DVIEWS.some(x => x[0] === v) ? v : "kanban"; };
    const isEnt = t => ENT.includes(t);
    const spId = () => tab.startsWith("sp:") ? tab.slice(3) : null;
    function setTab(k) { tab = k; if (k !== "bin" && !k.startsWith("open:")) ls.set("tab", k); st.sel.clear(); st.q = ""; search.value = ""; draw(); }
    function add() {
      if (isEnt(tab)) return edit(tab, {}, tab === "deals" ? { pipeline: curPipe(), stage: stagesFor(curPipe())[0]?.id } : tab === "companies" && st.ctype !== "all" ? { type: st.ctype } : {}).then(id => id && openRecord(tab, id));
      if (spId()) return edit("items", {}, { type: spId() }).then(id => id && openRecord("items", id));
    }
    function tabList() {
      return [["deals", "Deals"], ["leads", "Leads"], ["contacts", "Contacts"], ["companies", "Companies"], ["my", "My activities"],
        ...smartTypes().map(t => ["sp:" + t.id, (t.icon || "🧩") + " " + t.name]), ["products", "Products"], ["estimates", "Estimates"], ["invoices", "Invoices"], ["forms", "Forms"], ["analytics", "Analytics"]];
    }
    function drawTabs() {
      const list = tabList(), sig = JSON.stringify(list) + "|" + tab;
      if (sig !== tabsSig) { tabsSig = sig; tabsBox.replaceChildren(Apps.tabs(list, tab, k => setTab(k))); }
      const n = acts().filter(a => isPlan(a) && a.owner === me() && recLive(a.entity)), over = n.filter(late).length;
      const btn = [...tabsBox.querySelectorAll(".app-tabs button")][4];
      if (btn) { btn.querySelector(".crm-tab-n")?.remove(); if (n.length) btn.append(h("span", { class: "crm-tab-n" + (over ? " late" : ""), text: over || n.length, title: over ? over + " overdue" : n.length + " open" })); }
    }
    function drawSummary() {
      if (!isEnt(tab)) return summary.replaceChildren();
      const deals = live("deals"), open = deals.filter(isOpenDeal), m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
      const won = deals.filter(d => dStage(d).sem === "won" && (d.closedAt || d.at) >= m0.getTime());
      const leads = live("leads"), conv = leads.length ? Math.round(leads.filter(l => l.status === "converted").length / leads.length * 100) : 0;
      const mine = acts().filter(a => isPlan(a) && a.owner === me() && recLive(a.entity)), over = mine.filter(late).length;
      summary.replaceChildren(...[["Open pipeline", Apps.money(sum(open)), `${open.length} deals`], ["Won this month", Apps.money(sum(won)), `${won.length} deals`],
        ["New leads", leads.filter(l => (l.status || "new") === "new").length, `${leads.length} total · ${conv}% converted`], ["My activities", mine.length, over ? `${over} overdue` : "none overdue", over ? "late" : ""]].map(([l, v, s, c], i) =>
        h("div", { class: "kpi glass" + (c ? " " + c : ""), style: { animationDelay: i * 60 + "ms" }, onclick: i === 3 ? () => setTab("my") : null }, h("span", { text: l }), h("b", { text: v }), h("small", { text: s }))));
    }
    const textOf = r => (JSON.stringify(r) + " " + name("companies", r.company) + " " + name("contacts", r.contact) + " " + (r.owner ? Data.person(r.owner).name : "")).toLowerCase();
    const match = r => !st.q || textOf(r).includes(st.q);
    function rowsFor(col) {
      let rows = live(col).filter(match);
      if (col === "deals") rows = rows.filter(d => pipeOf(d) === curPipe());
      if (col === "companies" && st.ctype !== "all") rows = rows.filter(c => (c.type || "client") === st.ctype);
      return rows;
    }
    const listMenu = (anchor, col) => UI.menu(anchor, [
      ENT.includes(col) ? { label: "Export CSV", icon: "download", onClick: () => exportCsv(col, rowsFor(col)) } : null,
      ENT.includes(col) ? { label: "Import CSV", iconHtml: "⬆️", onClick: () => importCsv(col, { pipeline: curPipe() }) } : null,
      ["leads", "contacts", "companies"].includes(col) ? { label: "Find duplicates", iconHtml: "🔗", onClick: () => findDupes(col) } : null,
      ENT.includes(col) ? { label: "Configure fields", iconHtml: "🧾", onClick: () => configureFields(col) } : null,
      col === "deals" ? { label: "Pipelines & stages", iconHtml: "🛤️", onClick: () => configurePipelines(curPipe()) } : null,
      col === "items" && smartType(spId()) ? { label: "Edit this process", iconHtml: "🧩", onClick: () => editSmart(smartType(spId()), id => { if (!id) setTab("deals"); }) } : null,
      { sep: true }, { label: "Recycle bin", icon: "trash", onClick: () => setTab("bin") },
    ], { align: "end" });
    function drawTools() {
      const kids = [];
      if (tab === "deals" || tab === "analytics") {
        const pb = h("button", { class: "chip-btn crm-pipe", onclick: () => UI.menu(pb, [...pipelines().map(p => ({ label: p.name, iconHtml: p.id === curPipe() ? "✓" : "", onClick: () => { ls.set("pipe", p.id); st.sel.clear(); draw(); } })),
          { sep: true }, { label: "Configure pipelines…", iconHtml: "⚙️", onClick: () => configurePipelines(curPipe()) }]) }, h("span", { text: "🛤️ " + pipeline(curPipe()).name }), h("span", { class: "crm-caret", text: "▾" }));
        kids.push(pb);
      }
      if (tab === "deals") kids.push(h("div", { class: "seg crm-views" }, ...DVIEWS.map(([k, l]) => h("button", { class: dview() === k ? "on" : "", text: l, onclick: () => { ls.set("dview", k); st.sel.clear(); draw(); } }))));
      if (spId()) { const v = ls.get("spview", "kanban"); kids.push(h("div", { class: "seg crm-views" }, ...[["kanban", "Kanban"], ["list", "List"]].map(([k, l]) => h("button", { class: v === k ? "on" : "", text: l, onclick: () => { ls.set("spview", k); draw(); } })))); }
      if (tab === "companies") kids.push(h("div", { class: "crm-chips" }, ...[["all", "All"], ["client", "Clients"], ["vendor", "Vendors"], ["partner", "Partners"]].map(([k, l]) =>
        h("button", { class: "chip-btn" + (st.ctype === k ? " on" : ""), onclick: () => { st.ctype = k; st.sel.clear(); draw(); } }, l, h("small", { text: String(k === "all" ? live("companies").length : live("companies").filter(c => (c.type || "client") === k).length) })))));
      if (isEnt(tab) || spId()) kids.push(search);
      if (tab === "bin") kids.push(h("button", { class: "btn", text: "← Back", onclick: () => setTab(ls.get("tab", "deals")) }));
      kids.push(h("span", { class: "grow" }));
      if (isEnt(tab) || spId()) { const mb = h("button", { class: "icon-btn crm-more", title: "More actions", html: UI.icon("dots"), onclick: () => listMenu(mb, spId() ? "items" : tab) }); kids.push(mb); }
      // keep the search box (and its focus) instead of rebuilding it
      const focused = document.activeElement === search, a = search.selectionStart, b = search.selectionEnd;
      tools.replaceChildren(...kids);
      if (focused) { search.focus(); try { search.setSelectionRange(a, b); } catch {} }
      tools.parentElement.hidden = kids.length <= 1;
    }

    /* ----- list (sortable, checkboxes, bulk actions) ----- */
    function entityList(col, rows, cols, opts = {}) {
      const key = opts.key || col, so = st.sort[key] || { k: opts.sort || "at", dir: -1 };
      const c = cols.find(x => x.k === so.k), val = r => c?.s ? c.s(r) : r[so.k] ?? (so.k === "at" ? r.at : "");
      rows = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true })) * so.dir; });
      if (!rows.length) return Apps.empty(opts.icon || ICON[col], st.q ? "No matches." : opts.empty || `No ${PLURAL[col]} yet.`, opts.onAdd ? h("button", { class: "btn primary", text: "+ New " + (opts.label || LABEL[col]), onclick: opts.onAdd }) : null);
      const ids = new Set(rows.map(r => r.id));
      [...st.sel].forEach(id => { if (!ids.has(id)) st.sel.delete(id); });
      const tpl = "34px " + cols.map(x => x.w || "1fr").join(" ");
      const all = h("input", { type: "checkbox", title: "Select all", checked: rows.length && rows.every(r => st.sel.has(r.id)), onclick: e => e.stopPropagation(), onchange: e => { rows.forEach(r => e.target.checked ? st.sel.add(r.id) : st.sel.delete(r.id)); draw(); } });
      const sel = rows.filter(r => st.sel.has(r.id));
      const bulk = sel.length ? h("div", { class: "crm-bulk glass" }, h("b", { text: `${sel.length} selected` }), h("span", { class: "grow" }),
        ...(opts.bulk || []).map(b => { const btn = h("button", { class: "btn", text: b.label, onclick: () => b.run(btn, sel) }); return btn; }),
        h("button", { class: "btn", text: "👤 Responsible", onclick: e => Apps.personPicker(e.currentTarget, p => { if (!p) return; sel.forEach(r => Data.update(col, r.id, { owner: p.key })); if (p.key !== me()) Data.notify(p.key, `${ICON[col]} <b>${esc(Data.me().name)}</b> made you responsible for ${sel.length} ${sel.length === 1 ? typeLabel(col) : PLURAL[col]}`, "#/app/crm/" + (col === "items" ? tab : col)); UI.toast("👤 Responsible changed"); st.sel.clear(); }) }),
        h("button", { class: "btn danger", text: "🗑️ Delete", onclick: () => { softDelete(col, sel.map(r => r.id)); st.sel.clear(); draw(); } }),
        h("button", { class: "icon-btn", title: "Clear selection", html: UI.icon("x"), onclick: () => { st.sel.clear(); draw(); } })) : null;
      return h("div", { class: "crm-listwrap" }, bulk,
        h("div", { class: "tlist crm-list" },
          h("div", { class: "trow head", style: { gridTemplateColumns: tpl } }, all, ...cols.map(x => h("span", { class: "crm-th" + (x.k && so.k === x.k ? " on" : ""), onclick: x.k ? () => { st.sort[key] = { k: x.k, dir: so.k === x.k ? -so.dir : (x.num ? -1 : 1) }; draw(); } : null },
            x.l, x.k && so.k === x.k ? h("i", { text: so.dir > 0 ? " ↑" : " ↓" }) : null))),
          ...rows.map((r, i) => h("div", { class: "trow crm-tr" + (st.sel.has(r.id) ? " sel" : ""), style: { gridTemplateColumns: tpl, animationDelay: Math.min(i, 20) * 15 + "ms" }, onclick: () => openRecord(col, r.id) },
            h("input", { type: "checkbox", checked: st.sel.has(r.id), onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? st.sel.add(r.id) : st.sel.delete(r.id); draw(); } }),
            ...cols.map(x => { const v = x.v(r); return h("span", { class: "crm-td" + (x.cls ? " " + x.cls : ""), dataset: { label: x.l } }, v instanceof Node ? v : h("span", { class: "tt", text: v ?? "" })); })))));
    }
    const nextCol = col => ({ l: "Next activity", w: "1.3fr", k: "next", s: r => NX.get(col + ":" + r.id)?.due || 9e15, v: r => nextChip(NX.get(col + ":" + r.id)) });
    const ownerCol = { l: "Responsible", k: "owner", s: r => Data.person(r.owner).name, v: whoCell };
    function dealList(rows) {
      const stages = stagesFor(curPipe());
      return entityList("deals", rows, [
        { l: "Deal", k: "title", w: "1.6fr", v: r => nameCell("deals", r, name("companies", r.company)) },
        { l: "Stage", k: "stage", s: r => stages.findIndex(s => s.id === r.stage), v: r => tagEl(dStage(r).name, dStage(r).color) },
        { l: "Amount", k: "amount", num: 1, s: amt, w: ".9fr", v: r => h("b", { class: "tt", text: Apps.money(r.amount) }) },
        nextCol("deals"),
        { l: "Close", k: "close", w: ".8fr", v: r => h("span", { class: "dl" + (r.close && r.close < Apps.today() && isOpenDeal(r) ? " overdue" : ""), text: r.close ? Apps.fmtDate(r.close) : "—" }) },
        ownerCol,
      ], { key: "deals:" + curPipe(), onAdd: add, bulk: [{ label: "🚩 Change stage", run: (btn, sel) => UI.menu(btn, stages.map(s => ({ label: s.name, iconHtml: `<span class="crm-sw" style="background:var(--c-${s.color || "gray"})"></span>`, onClick: async () => {
        let reason = null; if (s.sem !== "process") { reason = await askReason(s); if (reason == null) return; }
        sel.forEach(d => setStage("deals", Data.get("deals", d.id), s.id, reason ?? ""));
        st.sel.clear(); draw();
      } }))) }] });
    }
    function dealActivities(rows) {
      const t0 = startOfDay(), now = Date.now(), wk = t0 + 7 * DAY;
      const groups = [["late", "Overdue", "red"], ["today", "Today", "orange"], ["week", "This week", "blue"], ["later", "Later", "purple"], ["none", "No activity", "gray"]];
      const g = d => { const a = NX.get("deals:" + d.id); if (!a) return "none"; if (!a.due) return "later"; if (a.due < now) return "late"; if (a.due < t0 + DAY) return "today"; if (a.due < wk) return "week"; return "later"; };
      const open = rows.filter(isOpenDeal);
      return h("div", { class: "board crm-board crm-actboard" }, ...groups.map(([k, l, c], i) => {
        const items = open.filter(d => g(d) === k).sort((a, b) => (NX.get("deals:" + a.id)?.due || 9e15) - (NX.get("deals:" + b.id)?.due || 9e15));
        return h("div", { class: "b-col crm-col", style: { "--sc": `var(--c-${c})`, animationDelay: i * 40 + "ms" } },
          h("div", { class: "b-col-h crm-col-h" }, h("span", { class: "crm-col-n", text: l }), h("span", { class: "n", text: items.length }), h("span", { class: "grow" }), h("small", { class: "sum", text: Apps.money(sum(items)) })),
          h("div", { class: "b-cards" }, ...items.map(d => card("deals", d, false)), items.length ? null : h("div", { class: "crm-col-empty", text: k === "late" ? "Nothing overdue 🎉" : "—" })));
      }));
    }
    function dealCalendar(rows) {
      const m = st.month, first = new Date(m.getFullYear(), m.getMonth(), 1), start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      const days = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
      while (days.length > 35 && days[days.length - 7].getMonth() !== m.getMonth()) days.splice(-7);
      const byDay = {}; rows.forEach(d => { if (d.close) (byDay[d.close] ||= []).push(d); });
      const shift = n => { st.month = new Date(m.getFullYear(), m.getMonth() + n, 1); draw(); };
      const noDate = rows.filter(d => !d.close && isOpenDeal(d)).length, today = Apps.today();
      const inMonth = rows.filter(d => d.close && d.close.slice(0, 7) === Apps.iso(first).slice(0, 7));
      return h("div", { class: "crm-cal" },
        h("div", { class: "crm-cal-head" }, h("button", { class: "icon-btn", text: "‹", title: "Previous month", onclick: () => shift(-1) }),
          h("b", { class: "cal-label", text: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
          h("button", { class: "icon-btn", text: "›", title: "Next month", onclick: () => shift(1) }), h("button", { class: "btn", text: "Today", onclick: () => { const d = new Date(); d.setDate(1); st.month = d; draw(); } }),
          h("span", { class: "grow" }), h("small", { class: "crm-hint", text: `${inMonth.length} closing · ${Apps.money(sum(inMonth.filter(isOpenDeal)))} open${noDate ? ` · ${noDate} without a date` : ""}` })),
        h("div", { class: "cal-grid crm-cal-grid" }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => h("div", { class: "cal-wd", text: w })),
          ...days.map(d => {
            const key = Apps.iso(d), list = byDay[key] || [];
            return h("div", { class: "cal-day" + (d.getMonth() !== m.getMonth() ? " other" : "") + (key === today ? " today" : ""), onclick: e => { if (e.target.closest(".cal-chip,.cal-more")) return; edit("deals", {}, { close: key, pipeline: curPipe() }).then(id => id && openRecord("deals", id)); } },
              h("span", { class: "cal-n", text: d.getDate() }),
              ...list.slice(0, 3).map(x => h("button", { class: "cal-chip crm-chip" + (isOpenDeal(x) ? "" : " closed"), style: { "--c": `var(--c-${dStage(x).color || "gray"})` }, title: `${x.title} · ${Apps.money(x.amount)} · ${dStage(x).name}`, onclick: () => openRecord("deals", x.id) }, x.title)),
              list.length > 3 ? h("button", { class: "cal-more", text: `+${list.length - 3} more`, onclick: e => UI.menu(e.currentTarget, list.map(x => ({ label: x.title + " · " + Apps.money(x.amount), iconHtml: "💼", onClick: () => openRecord("deals", x.id) }))) }) : null);
          })));
    }
    function myActivities() {
      const now = Date.now(), t1 = startOfDay() + DAY, t2 = t1 + DAY;
      const mine = acts().filter(a => isPlan(a) && a.owner === me() && recLive(a.entity)).sort((a, b) => (a.due || 9e15) - (b.due || 9e15));
      const groups = [["Overdue", a => a.due && a.due < now, "late"], ["Today", a => a.due && a.due >= now && a.due < t1, "today"], ["Tomorrow", a => a.due && a.due >= t1 && a.due < t2, ""], ["Later", a => !a.due || a.due >= t2, ""]];
      if (!mine.length) return Apps.empty("☕", "Nothing planned for you. Plan calls, meetings and tasks from any deal, lead, contact or company.");
      return h("div", { class: "crm-my" }, ...groups.map(([l, f, cls]) => {
        const items = mine.filter(f); if (!items.length) return null;
        return h("div", { class: "crm-my-g " + cls }, h("div", { class: "crm-my-h" }, h("b", { text: l }), h("span", { class: "n", text: items.length })),
          h("div", { class: "tlist crm-my-list" }, ...items.map((a, i) => {
            const r = Data.get(a.entity.col, a.entity.id);
            return h("div", { class: "crm-my-r" + (late(a) ? " late" : ""), style: { animationDelay: Math.min(i, 20) * 20 + "ms" }, onclick: () => openRecord(a.entity.col, a.entity.id) },
              h("input", { type: "checkbox", title: "Mark done", onclick: e => e.stopPropagation(), onchange: () => markDone(a) }),
              h("span", { class: "crm-my-ic", text: ATYPES[a.type]?.[0] || "📌" }),
              h("span", { class: "crm-my-t" }, h("b", { class: "tt", text: a.subject || ATYPES[a.type]?.[1] }), h("small", { class: "tt", text: (a.entity.col === "items" ? (smartType(r?.type)?.icon || "🧩") : ICON[a.entity.col]) + " " + recName(r) + (a.by && a.by !== me() ? " · from " + Data.person(a.by).name : "") })),
              h("span", { class: "crm-my-d", text: when(a.due) }));
          })));
      }));
    }
    function recycleBin() {
      const rows = HIST_COLS.flatMap(col => Data.list(col).filter(r => r && r.deleted).map(r => ({ col, r }))).sort((a, b) => (b.r.deletedAt || 0) - (a.r.deletedAt || 0));
      const head = h("div", { class: "crm-bin-head" }, h("div", null, h("h3", { text: "🗑️ Recycle bin" }), h("small", { class: "crm-hint", text: "Deleted records stay here until you delete them forever." })), h("span", { class: "grow" }),
        rows.length ? h("button", { class: "btn danger", text: "Empty bin", onclick: async () => { if (!(await UI.confirm(`Delete all ${rows.length} records forever? This can't be undone.`, "Delete forever"))) return; for (const x of rows) await hardDelete(x.col, x.r.id, false); UI.toast("🧹 Recycle bin emptied"); } }) : null);
      if (!rows.length) return h("div", null, head, Apps.empty("✨", "The recycle bin is empty."));
      return h("div", null, head, h("div", { class: "tlist crm-bin" }, ...rows.map(({ col, r }, i) => h("div", { class: "crm-bin-r", style: { animationDelay: Math.min(i, 20) * 15 + "ms" } },
        h("span", { class: "crm-my-ic", text: col === "items" ? (smartType(r.type)?.icon || "🧩") : ICON[col] }),
        h("span", { class: "crm-my-t" }, h("a", { class: "tt", text: recName(r), onclick: () => openRecord(col, r.id) }), h("small", { class: "tt", text: recLabel(col, r) + " · deleted " + (r.deletedAt ? UI.timeAgo(r.deletedAt) : "") + (r.deletedBy ? " by " + Data.person(r.deletedBy).name : "") + (r.mergedInto ? " · merged" : "") })),
        h("button", { class: "btn", text: "♻️ Restore", onclick: () => { restore(col, r.id); UI.toast("♻️ Restored"); } }),
        h("button", { class: "btn danger", text: "Delete forever", onclick: () => hardDelete(col, r.id) })))));
    }
    function external(k) {
      const box = h("div", { class: "crm-ext" });
      let cleanup = null;
      try {
        if (k === "forms") { if (Apps.Forms?.render) cleanup = Apps.Forms.render(box); else box.append(Apps.empty("📝", "Web forms aren't available right now. Reload the page in a moment.")); }
        else if (Apps.Sales?.render) cleanup = Apps.Sales.render(box, k);
        else box.append(Apps.empty(k === "products" ? "📦" : k === "invoices" ? "🧾" : "📝", (k === "products" ? "The product catalog" : cap(k)) + " isn't available right now. Reload the page in a moment."));
      } catch (e) { console.error(e); box.replaceChildren(Apps.empty("⚠️", "This section couldn't load. Try reloading the page.")); }
      return { k, box, cleanup: typeof cleanup === "function" ? cleanup : null };
    }
    function dropExt() { if (ext) { try { ext.cleanup?.(); } catch {} ext = null; } }

    function draw() {
      cancelAnimationFrame(raf); raf = 0;
      NX = nextIndex();
      // a smart-process tab whose type isn't known (yet): wait briefly for settings to load, then fall back to deals
      if (tab.startsWith("sp:") && !smartType(spId()) && (cfg().smart || Date.now() - t0 > 2500)) tab = "deals";
      drawTabs(); drawSummary(); drawTools();
      const sp = smartType(spId());
      addBtn.style.display = isEnt(tab) || sp ? "" : "none";
      addBtn.textContent = sp ? "+ New " + (sp.name || "item").toLowerCase() : isEnt(tab) ? "+ New " + LABEL[tab] : "";
      if (EXT.includes(tab)) {
        if (!ext || ext.k !== tab) { dropExt(); ext = external(tab); body.replaceChildren(ext.box); }
        return;
      }
      dropExt();
      if (tab.startsWith("sp:") && !sp) { body.replaceChildren(Apps.empty("🧩", "Loading…")); setTimeout(schedule, 2600); return; }
      let view;
      if (tab === "deals") {
        const rows = rowsFor("deals"), v = dview();
        view = v === "list" ? dealList(rows) : v === "activities" ? dealActivities(rows) : v === "calendar" ? dealCalendar(rows)
          : board("deals", stagesFor(curPipe()), rows, { addLabel: "Deal", onAdd: s => edit("deals", {}, { pipeline: curPipe(), stage: s.id }).then(id => id && openRecord("deals", id)) });
      }
      else if (tab === "leads") view = entityList("leads", rowsFor("leads"), [
        { l: "Lead", k: "name", w: "1.5fr", v: r => nameCell("leads", r, r.companyName) }, { l: "Source", k: "source", w: ".9fr", v: r => r.source || "—" },
        { l: "Status", k: "status", w: ".9fr", s: r => LEAD_ST.findIndex(x => x[0] === (r.status || "new")), v: r => leadTag(r.status) },
        { l: "Value", k: "value", num: 1, s: r => +r.value || 0, w: ".8fr", v: r => r.value ? Apps.money(r.value) : "—" }, nextCol("leads"), ownerCol], { onAdd: add });
      else if (tab === "contacts") view = entityList("contacts", rowsFor("contacts"), [
        { l: "Name", k: "name", w: "1.4fr", v: r => nameCell("contacts", r, r.position) }, { l: "Company", k: "company", s: r => name("companies", r.company), v: r => name("companies", r.company) || "—" },
        { l: "Email", k: "email", w: "1.3fr", v: r => r.email || "—" }, { l: "Phone", k: "phone", v: r => r.phone || "—" }, nextCol("contacts"), ownerCol], { onAdd: add });
      else if (tab === "companies") view = entityList("companies", rowsFor("companies"), [
        { l: "Company", k: "name", w: "1.5fr", v: r => nameCell("companies", r, r.industry) },
        { l: "Type", k: "type", w: ".8fr", s: r => r.type || "client", v: r => tagEl(fmtVal("companies", r, "type", r.type || "client"), { client: "blue", vendor: "orange", partner: "purple" }[r.type || "client"]) },
        { l: "Contacts", k: "contacts", w: ".7fr", num: 1, s: r => live("contacts").filter(c => c.company === r.id).length, v: r => String(live("contacts").filter(c => c.company === r.id).length) },
        { l: "Open deals", k: "open", w: ".9fr", num: 1, s: r => sum(live("deals").filter(d => d.company === r.id && isOpenDeal(d))), v: r => Apps.money(sum(live("deals").filter(d => d.company === r.id && isOpenDeal(d)))) },
        nextCol("companies"), ownerCol], { key: "companies", onAdd: add, empty: st.ctype === "all" ? "No companies yet." : `No ${st.ctype}s yet.` });
      else if (sp) {
        const rows = live("items").filter(x => x.type === sp.id).filter(match);
        view = ls.get("spview", "kanban") === "list"
          ? entityList("items", rows, [{ l: "Title", k: "title", w: "1.6fr", v: r => nameCell("items", r) },
            { l: "Stage", k: "stage", s: r => (sp.stages || []).findIndex(s => s.id === r.stage), v: r => tagEl(stageOf("items", r).name, stageOf("items", r).color) },
            { l: "Amount", k: "amount", num: 1, s: amt, w: ".8fr", v: r => r.amount ? Apps.money(r.amount) : "—" }, nextCol("items"), ownerCol],
            { key: "items:" + sp.id, icon: sp.icon || "🧩", label: (sp.name || "item").toLowerCase(), empty: `No ${sp.name.toLowerCase()} yet.`, onAdd: add,
              bulk: [{ label: "🚩 Change stage", run: (btn, sel) => UI.menu(btn, (sp.stages || []).map(s => ({ label: s.name, onClick: () => { sel.forEach(r => setStage("items", Data.get("items", r.id), s.id)); st.sel.clear(); draw(); } }))) }] })
          : board("items", sp.stages || [], rows, { addLabel: (sp.name || "item").toLowerCase(), onAdd: s => edit("items", {}, { type: sp.id, stage: s.id }).then(id => id && openRecord("items", id)) });
      }
      else if (tab === "my") view = myActivities();
      else if (tab === "analytics") view = analytics(curPipe());
      else if (tab === "bin") view = recycleBin();
      else { tab = "deals"; return draw(); }
      // keep the kanban scroll position across live redraws
      const sx = body.querySelector(".board")?.scrollLeft || 0;
      body.replaceChildren(view);
      const b2 = body.querySelector(".board"); if (b2 && sx) b2.scrollLeft = sx;
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    const offs = ["deals", "leads", "contacts", "companies", "items", "activities", "settings", "people"].map(c => Data.on(c, schedule));
    const onWs = () => schedule(); Apps.onWorkspace.add(onWs);
    draw();
    if (openAfter && Data.get(openAfter[0], openAfter[1])) setTimeout(() => openRecord(openAfter[0], openAfter[1]), 80);
    return () => { offs.forEach(f => f()); Apps.onWorkspace.delete(onWs); cancelAnimationFrame(raf); dropExt(); };
  }

  Apps.register("crm", { title: "CRM", icon: "💼", render });
  Apps.CRM = {
    openRecord, pipelines, stagesFor, live, edit,
    stageOf: d => dStage(d), isOpen: d => isOpenDeal(d), sem: d => dStage(d).sem,
    // [id, name, color] of every pipeline's stages (default pipeline first): Automation's "deal moves to stage" list
    get STAGES() { const seen = new Set(); return pipelines().flatMap(p => (p.stages || []).map(s => [s.id, pipelines().length > 1 && p.id !== "default" ? p.name + " · " + s.name : s.name, s.color])).filter(s => !seen.has(s[0]) && seen.add(s[0])); },
  };
})();
