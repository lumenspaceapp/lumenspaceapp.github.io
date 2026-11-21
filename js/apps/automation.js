/* Automation (Bitrix24-style): rules & triggers, approvals (business processes), RPA processes, Lists (custom databases), analytics.
   Rules run on the device of the person whose change triggered them (Data.hooks fire only for local writes), so they never run twice. */
(function () {
  const { h, esc } = UI;
  const DAY = 86400000;
  const me = () => Data.me().key;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const LS = {
    get(k, d) { try { return localStorage.getItem("lumen-auto-" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lumen-auto-" + k, v); } catch {} },
  };
  const COLORS = ["gray", "blue", "purple", "pink", "orange", "yellow", "green", "brown", "red"];
  const cvar = c => !c ? "var(--c-gray)" : c[0] === "#" ? c : `var(--c-${c})`;
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
  const low = s => String(s ?? "").trim().toLowerCase();
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const isEmpty = v => v == null || v === "" || v === false || (Array.isArray(v) && !v.length);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const dur = ms => {
    if (!(ms > 0)) return "—";
    const m = ms / 60000; if (m < 60) return Math.max(1, Math.round(m)) + " min";
    const hr = m / 60; if (hr < 48) return (hr < 10 ? hr.toFixed(1) : Math.round(hr)) + " h";
    const d = hr / 24; return (d < 10 ? d.toFixed(1) : Math.round(d)) + " d";
  };
  const setHash = arg => { try { history.replaceState(null, "", "#/app/automation" + (arg ? "/" + encodeURIComponent(arg) : "")); } catch {} };

  /* ---------- people, roles (guarded: access.js and company.js are optional) ---------- */
  const isAdmin = () => { try { return Apps.isAdmin ? !!Apps.isAdmin() : true; } catch { return true; } };
  const canView = () => { try { return Apps.can ? Apps.can("automation", "view") !== false : true; } catch { return true; } };
  const ownerKey = () => String(window.Cloud?.ws?.ownerEmail || "").toLowerCase() || me();
  function admins() {
    const ws = window.Cloud?.ws;
    if (!ws) return [me()];
    const out = new Set([ownerKey()]);
    Object.entries(ws.roles || {}).forEach(([e, r]) => { if (r === "admin") out.add(String(e).toLowerCase()); });
    if (Apps.isAdmin) Data.people().forEach(p => { try { if (Apps.isAdmin(p.key)) out.add(p.key); } catch {} });
    const list = [...out].filter(Boolean);
    return list.length ? list : [me()];
  }
  function managerOf(key) {
    let m = null;
    try { m = Apps.HR?.managerOf ? Apps.HR.managerOf(key) : null; } catch {}
    return m || (window.Cloud?.ws ? ownerKey() : me());
  }
  function headOf(dept) { let k = null; try { k = dept && Apps.HR?.headOf ? Apps.HR.headOf(dept) : null; } catch {} return k || null; }
  const pname = k => Data.person(k).name || "Someone";
  const firstName = k => pname(k).split(" ")[0];
  const notifyMany = (keys, html, link, body) => [...new Set((keys || []).filter(Boolean))].forEach(k => Data.notify(k, html, link, body));

  /* ---------- CRM stages (guarded) ---------- */
  const STAGES0 = [["new", "New", "gray"], ["qualified", "Qualified", "blue"], ["proposal", "Proposal", "purple"], ["negotiation", "Negotiation", "orange"], ["won", "Won", "green"], ["lost", "Lost", "red"]];
  const defPipe = () => ({ id: "default", name: "Default pipeline", stages: STAGES0.map(([id, name, color]) => ({ id, name, color, sem: id === "won" ? "won" : id === "lost" ? "lost" : "process" })) });
  function pipes() { try { const p = Apps.CRM?.pipelines?.(); return p && p.length ? p : [defPipe()]; } catch { return [defPipe()]; } }
  function stagesOf(pid) { try { const s = Apps.CRM?.stagesFor?.(pid || "default"); if (s && s.length) return s; } catch {} return (pipes().find(p => p.id === (pid || "default")) || pipes()[0]).stages || []; }
  function allStages() { const seen = new Set(); return pipes().flatMap(p => p.stages || []).filter(s => !seen.has(s.id) && seen.add(s.id)); }
  function stageName(pid, sid) { const s = (pid ? stagesOf(pid) : []).find(x => x.id === sid) || allStages().find(x => x.id === sid); return s ? s.name : (sid || ""); }

  /* ---------- custom fields (lists, processes, approval forms) ---------- */
  const FTYPES = [["text", "Text"], ["number", "Number"], ["date", "Date"], ["select", "List of options"], ["person", "Person"], ["checkbox", "Yes / no"], ["file", "File"], ["url", "Link"]];
  const FT_IC = { text: "Aa", number: "#", date: "📅", select: "☰", person: "👤", checkbox: "☑", file: "📎", url: "🔗" };
  const isMoney = f => f.type === "number" && /amount|price|cost|salary|budget|total|sum/i.test((f.label || "") + " " + (f.key || ""));
  function plain(f, v) {
    if (f.type === "checkbox") return v ? "Yes" : "";
    if (isEmpty(v)) return "";
    if (f.type === "person") return pname(v);
    if (f.type === "file") return (Array.isArray(v) ? v : []).map(a => a.name).join(", ");
    if (f.type === "date") return Apps.fmtDate(v);
    if (f.type === "number") return isMoney(f) ? Apps.money(v) : (+v).toLocaleString();
    return String(v);
  }
  function show(f, v, compact) {
    if (f.type === "checkbox") return v ? h("span", { class: "au-yes", text: "✓" }) : h("span", { class: "au-dim", text: "—" });
    if (isEmpty(v)) return h("span", { class: "au-dim", text: "—" });
    if (f.type === "person") return h("span", { class: "au-person" }, Apps.avatar(Data.person(v), 20), h("span", { text: pname(v) }));
    if (f.type === "file") return compact ? h("span", { class: "au-dim", text: "📎 " + v.length }) : h("span", { class: "file-list au-files" }, ...(Array.isArray(v) ? v : []).map(a => Apps.fileChip(a)));
    if (f.type === "url") return /^https?:\/\//i.test(v) ? h("a", { class: "au-link", href: v, target: "_blank", rel: "noopener", text: String(v).replace(/^https?:\/\//i, ""), onclick: e => e.stopPropagation() }) : h("span", { text: v });
    if (f.type === "select") return h("span", { class: "au-tag", text: v });
    return h("span", { text: plain(f, v) });
  }
  const preview = (fields, values, n = 3) => (fields || []).filter(f => f.type !== "file" && !isEmpty(values?.[f.key])).slice(0, n).map(f => f.label + ": " + plain(f, values[f.key])).join(" · ");
  const cleanFields = arr => (arr || []).filter(f => String(f.label || "").trim()).map(f => ({ key: f.key || "f" + uid(), label: f.label.trim(), type: f.type || "text", ...(f.type === "select" ? { options: f.options || [] } : {}), ...(f.required ? { required: true } : {}) }));

  function control(f, v, track) {
    const k = f.key;
    if (f.type === "select") {
      const s = h("select", { class: "menu-input" }, h("option", { value: "", text: "—" }), ...(f.options || []).map(o => h("option", { value: o, text: o, selected: v[k] === o })));
      s.onchange = () => (v[k] = s.value); return s;
    }
    if (f.type === "checkbox") { const c = h("input", { type: "checkbox", checked: !!v[k] }); c.onchange = () => (v[k] = c.checked); return h("label", { class: "au-check" }, c, h("span", { text: "Yes" })); }
    if (f.type === "person") {
      const b = h("button", { type: "button", class: "menu-input f-person" });
      const paint = () => b.replaceChildren(v[k] ? Apps.avatar(Data.person(v[k]), 20) : null, h("span", { text: v[k] ? pname(v[k]) : "Choose someone…" }));
      b.onclick = () => Apps.personPicker(b, p => { v[k] = p ? p.key : ""; paint(); }, { allowNone: true }); paint(); return b;
    }
    if (f.type === "file") {
      if (!Array.isArray(v[k])) v[k] = [];
      const box = h("div", { class: "file-list au-files" }), add = h("button", { type: "button", class: "chip-btn", text: "📎 Attach" });
      const paint = () => box.replaceChildren(...v[k].map(a => Apps.fileChip(a, x => { v[k] = v[k].filter(y => y.id !== x.id); paint(); })), add);
      add.onclick = async () => {
        const files = await Apps.pickFiles(true); if (!files.length) return;
        track(1); add.textContent = "Uploading…"; add.disabled = true;
        try { v[k] = [...v[k], ...(await Apps.attach(files))]; } finally { track(-1); add.textContent = "📎 Attach"; add.disabled = false; paint(); }
      };
      paint(); return box;
    }
    if (f.type === "textarea") { const t = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: f.placeholder || "" }); t.value = v[k] || ""; t.oninput = () => (v[k] = t.value); return t; }
    const i = h("input", { class: "menu-input", type: f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : "text", placeholder: f.placeholder || (f.type === "url" ? "https://" : ""), value: v[k] ?? "" });
    if (f.type === "number") i.step = "any";
    i.oninput = () => (v[k] = f.type === "number" ? (i.value === "" ? "" : +i.value) : i.value);
    return i;
  }
  // a form for custom fields (text, number, date, select, person, checkbox, file, url); resolves with the values or null
  function fieldForm(title, fields, values = {}, opts = {}) {
    return new Promise(resolve => {
      const v = JSON.parse(JSON.stringify(values || {})); let done = false, uploading = 0;
      const rows = fields.map(f => h("div", { class: "f-row" + (f.half ? " half" : "") }, h("span", null, f.label || "Field", f.required ? h("b", { class: "au-req", text: " *" }) : null), control(f, v, n => (uploading += n))));
      const finish = () => {
        if (uploading) return UI.toast("Wait for the upload to finish");
        const miss = fields.find(f => f.required && isEmpty(v[f.key]));
        if (miss) return UI.toast(`${miss.label} is required`);
        done = true; m.close(); resolve(v);
      };
      const m = UI.modal(title, h("form", { class: "f-grid au-form", onsubmit: e => { e.preventDefault(); finish(); } }, opts.intro || null, ...rows,
        !fields.length ? h("p", { class: "au-intro", text: "This form has no fields." }) : null,
        h("div", { class: "f-actions" },
          opts.onDelete ? h("button", { type: "button", class: "btn danger", text: opts.deleteLabel || "Delete", onclick: async () => { if (await UI.confirm(opts.deleteAsk || "Delete this item?", opts.deleteLabel || "Delete")) { done = true; m.close(); opts.onDelete(); resolve(null); } } }) : h("span"),
          h("span", { class: "au-acts" }, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { type: "submit", class: "btn primary", text: opts.ok || "Save" })))), { onClose: () => !done && resolve(null) });
      m.el.style.width = (opts.width || 540) + "px"; m.el.classList.add("au-modal");
      setTimeout(() => m.el.querySelector("input:not([type=checkbox]),textarea,select")?.focus(), 60);
    });
  }
  // read-only view of values
  function valuesGrid(fields, values) {
    const rows = (fields || []).flatMap(f => [h("span", { text: f.label }), h("div", null, show(f, values?.[f.key]))]);
    return rows.length ? h("div", { class: "td-grid au-vals" }, ...rows) : h("div", { class: "au-dim", text: "No fields" });
  }
  const mvBtns = (arr, i, redraw) => [
    h("button", { type: "button", class: "icon-btn xs", title: "Move up", text: "↑", disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; redraw(); } }),
    h("button", { type: "button", class: "icon-btn xs", title: "Move down", text: "↓", disabled: i === arr.length - 1, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; redraw(); } })];
  const delBtn = (arr, i, redraw, min = 0) => h("button", { type: "button", class: "icon-btn xs au-del", title: "Remove", html: UI.icon("x"), disabled: arr.length <= min, onclick: () => { arr.splice(i, 1); redraw(); } });
  // edit a fields array in place
  function fieldsEditor(arr) {
    const box = h("div", { class: "au-fe" });
    const draw = () => box.replaceChildren(...arr.map((f, i) => {
      const lab = h("input", { class: "menu-input", value: f.label || "", placeholder: "Field name" }); lab.oninput = () => (f.label = lab.value);
      const ty = h("select", { class: "menu-input au-fe-ty" }, ...FTYPES.map(([k, l]) => h("option", { value: k, text: l, selected: (f.type || "text") === k })));
      ty.onchange = () => { f.type = ty.value; draw(); };
      const opt = h("input", { class: "menu-input au-fe-opt", value: (f.options || []).join(", "), placeholder: "Options, separated by commas" });
      opt.oninput = () => (f.options = opt.value.split(",").map(s => s.trim()).filter(Boolean));
      const req = h("label", { class: "au-fe-req", title: "Required" }, h("input", { type: "checkbox", checked: !!f.required, onchange: e => (f.required = e.target.checked) }), h("span", { text: "Required" }));
      return h("div", { class: "au-fe-row" }, h("span", { class: "au-fe-ic", text: FT_IC[f.type] || "Aa" }), lab, ty, req, ...mvBtns(arr, i, draw), delBtn(arr, i, draw), f.type === "select" ? opt : null);
    }), h("button", { type: "button", class: "chip-btn", text: "+ Add field", onclick: () => { arr.push({ key: "f" + uid(), label: "", type: "text" }); draw(); const ins = box.querySelectorAll(".au-fe-row > input.menu-input:not(.au-fe-opt)"); ins[ins.length - 1]?.focus(); } }));
    draw(); return box;
  }
  // a modal for designers (lists, processes, workflows, rules)
  function designer(title, body, { onSave, onDelete, ok = "Save", width = 660, deleteAsk }) {
    const save = h("button", { class: "btn primary", type: "button", text: ok });
    const m = UI.modal(title, h("div", { class: "au-design" }, body, h("div", { class: "f-actions" },
      onDelete ? h("button", { class: "btn danger", type: "button", text: "Delete", onclick: async () => { if (await UI.confirm(deleteAsk || "Delete this? This can't be undone.")) { m.close(); onDelete(); } } }) : h("span"),
      h("span", { class: "au-acts" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => m.close() }), save))));
    save.onclick = async () => { if ((await onSave()) !== false) m.close(); };
    m.el.style.width = width + "px"; m.el.classList.add("au-modal");
    return m;
  }
  const sec = (label, ...kids) => h("div", { class: "au-dsec" }, h("div", { class: "au-dsec-h", text: label }), ...kids);
  const frow = (label, ...kids) => h("div", { class: "f-row" }, h("span", { text: label }), ...kids);
  const textIn = (obj, key, ph, type = "text") => { const i = h("input", { class: "menu-input", type, value: obj[key] ?? "", placeholder: ph || "" }); i.oninput = () => (obj[key] = type === "number" ? (i.value === "" ? "" : +i.value) : i.value); return i; };
  function emojiBtn(obj, key = "icon") { const b = h("button", { type: "button", class: "au-emoji", title: "Choose an icon", text: obj[key] || "📋" }); b.onclick = () => UI.emojiPicker(b, e => { if (e) { obj[key] = e; b.textContent = e; } }); return b; }
  function selectEl(opts, val, on, cls) {
    const mk = o => h("option", { value: o[0], text: o[1], selected: String(val ?? "") === String(o[0]) });
    const s = h("select", { class: "menu-input" + (cls ? " " + cls : "") }, ...opts.map(o => o.group ? h("optgroup", { label: o.group }, ...o.items.map(mk)) : mk(o)));
    s.onchange = () => on(s.value); return s;
  }

  /* ---------- live side panels ---------- */
  const panelOffs = new Set();
  function livePanel(title, cols, draw, actions = []) {
    const body = h("div", { class: "au-panel" });
    const p = Apps.panel(title, body, actions);
    p.el.classList.add("au-slider");
    const run = () => { try { draw(body, p); } catch (e) { console.error("automation panel", e); } };
    const redraw = UI.liveDraw(body, run);
    let raf = 0; const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };
    run();
    const offs = cols.map(c => Data.on(c, sched));
    const off = () => { cancelAnimationFrame(raf); offs.forEach(f => f()); panelOffs.delete(off); };
    panelOffs.add(off); p.onClose = off; p.refresh = run;
    return p;
  }

  /* =====================================================================
     RULES: "When <trigger> [if <conditions>] then <action>"
     ===================================================================== */
  const TRIGGERS = {
    deal_created: { label: "A deal is created", icon: "💼", col: "deals" },
    deal_stage: { label: "A deal moves to stage…", icon: "🚩", col: "deals", needsStage: true },
    lead_created: { label: "A new lead comes in", icon: "🧲", col: "leads" },
    form_lead: { label: "A lead comes from a web form", icon: "📝", col: "leads" },
    task_created: { label: "A task is created", icon: "✅", col: "tasks" },
    task_done: { label: "A task is completed", icon: "🏁", col: "tasks" },
    task_overdue: { label: "A task becomes overdue", icon: "⏰", col: "tasks" },
    invoice_paid: { label: "An invoice is paid", icon: "💸", col: "quotes" },
    booking_created: { label: "A booking is made", icon: "🗓️", col: "bookings" },
    low_stock: { label: "A product runs low on stock", icon: "📦", col: "products" },
    absence_requested: { label: "Someone requests time off", icon: "🌴", col: "absences" },
    wf_done: { label: "An approval is finished", icon: "📋", col: "wfruns" },
  };
  const TGROUPS = [["CRM", ["deal_created", "deal_stage", "lead_created", "form_lead"]], ["Tasks", ["task_created", "task_done", "task_overdue"]],
    ["Sales & booking", ["invoice_paid", "booking_created", "low_stock"]], ["Team", ["absence_requested", "wf_done"]]];
  const TFIELDS = {
    deals: [["title", "Deal name", "text"], ["amount", "Amount", "number"], ["stage", "Stage", "text"], ["source", "Source", "text"], ["owner", "Responsible", "person"]],
    leads: [["name", "Lead name", "text"], ["value", "Value", "number"], ["source", "Source", "text"], ["companyName", "Company", "text"], ["owner", "Responsible", "person"]],
    tasks: [["title", "Title", "text"], ["priority", "Priority", "text"], ["assignee", "Responsible", "person"]],
    quotes: [["number", "Number", "text"], ["title", "Title", "text"], ["total", "Total", "number"]],
    bookings: [["name", "Client", "text"], ["service", "Service", "text"], ["price", "Price", "number"], ["date", "Date (YYYY-MM-DD)", "text"]],
    products: [["name", "Product", "text"], ["sku", "SKU", "text"], ["stock", "Stock left", "number"], ["minStock", "Minimum stock", "number"]],
    absences: [["type", "Type", "text"], ["who", "Person", "person"], ["days", "Days", "number"]],
    wfruns: [["workflow", "Approval", "text"], ["status", "Result (approved / declined)", "text"], ["by", "Requester", "person"]],
  };
  const PH = { deals: "{title}, {amount}, {stage}, {who}", leads: "{name}, {value}, {source}, {who}", tasks: "{title}, {who}", quotes: "{number}, {title}, {amount}",
    bookings: "{title}, {name}, {date}, {price}", products: "{name}, {stock}, {minStock}", absences: "{name}, {type}, {days}", wfruns: "{workflow}, {status}, {name}" };
  const ACTIONS = {
    notify: { label: "Send a notification", icon: "🔔", text: "Message", who: true },
    create_task: { label: "Create a task", icon: "✅", text: "Task title", who: true, days: "Task due in (days)" },
    assign: { label: "Assign a responsible person", icon: "👤", who: true, cols: ["deals", "leads", "tasks"] },
    deal_stage_set: { label: "Change the deal stage", icon: "🚩", cols: ["deals"] },
    crm_activity: { label: "Add a CRM activity", icon: "📞", text: "Subject", who: true, days: "Due in (days)", cols: ["deals", "leads"] },
    post_chat: { label: "Send a chat message", icon: "💬", text: "Message" },
    post_feed: { label: "Post on the Feed", icon: "📰", text: "Post text" },
    start_wf: { label: "Start an approval", icon: "📋", text: "What it's about" },
  };
  const ACT_TYPES = [["call", "📞 Call"], ["meeting", "🤝 Meeting"], ["task", "✅ To-do"], ["email", "✉️ Email"]];
  const WHO = [["owner", "The responsible person"], ["manager", "Their manager"], ["trigger", "Whoever made the change"], ["me", "Me (rule author)"]];
  const PRESETS = [
    { name: "Won deal → onboarding task", trigger: "deal_stage", stage: "won", action: "create_task", text: "Onboard new customer: {title}", who: "owner", days: 2 },
    { name: "Big deal → tell me", trigger: "deal_created", conds: [{ field: "amount", op: "gt", value: "50000" }], action: "notify", text: "💰 Big deal: {title} ({amount})", who: "me" },
    { name: "New lead → notify me", trigger: "lead_created", action: "notify", text: "🧲 New lead: {name}", who: "me" },
    { name: "Web form lead → call back", trigger: "form_lead", action: "crm_activity", actType: "call", text: "Call back {name}", who: "owner", days: 1 },
    { name: "Invoice paid → celebrate", trigger: "invoice_paid", action: "post_feed", text: "💸 Invoice {number} was paid: {amount}" },
    { name: "New booking → notify me", trigger: "booking_created", action: "notify", text: "🗓️ New booking: {title} on {date}", who: "me" },
    { name: "Time off request → manager", trigger: "absence_requested", action: "notify", text: "🌴 {name} asked for time off ({days} days)", who: "manager" },
    { name: "Overdue task → chat alert", trigger: "task_overdue", action: "post_chat", text: "⏰ Task is overdue: {title} ({who})" },
    { name: "Task done → celebrate on Feed", trigger: "task_done", action: "post_feed", text: "🎉 {who} completed “{title}”" },
  ];

  const quoteTotal = q => { try { if (Apps.Sales?.totals) return +Apps.Sales.totals(q.items || []).total || 0; } catch {} return (q.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0) * (1 - (+i.discount || 0) / 100) * (1 + (+i.tax || 0) / 100), 0); };
  // flatten a record into the values that conditions and {placeholders} use
  function ctxOf(trigger, rec) {
    const c = { ...rec }, col = TRIGGERS[trigger]?.col;
    if (col === "deals") { c.stageId = rec.stage; c.stage = stageName(rec.pipeline || "default", rec.stage); c.amount = +rec.amount || 0; }
    if (col === "leads") { c.title = rec.name; c.value = +rec.value || 0; }
    if (col === "tasks") c.owner = rec.assignee || rec.by;
    if (col === "bookings") { c.name = rec.client?.name || ""; c.service = Data.get("bookings", rec.service)?.name || ""; c.title = [c.service, c.name].filter(Boolean).join(" · ") || "Booking"; c.owner = Data.get("bookings", rec.resource)?.person || rec.by; c.price = +rec.price || 0; }
    if (col === "quotes") { c.total = quoteTotal(rec); c.amount = c.total; c.title = rec.title || rec.number || "Invoice"; c.name = c.title; }
    if (col === "products") c.title = rec.name;
    if (col === "absences") {
      c.owner = rec.who; c.name = pname(rec.who);
      c.days = rec.from ? Math.max(1, Math.round((new Date((rec.to || rec.from) + "T00:00") - new Date(rec.from + "T00:00")) / DAY) + 1) : 1;
      c.title = `${c.name}: ${rec.type || "time off"} ${Apps.fmtDate(rec.from)}${rec.to && rec.to !== rec.from ? "–" + Apps.fmtDate(rec.to) : ""}`;
    }
    if (col === "wfruns") { c.workflow = rec.name || Data.get("workflows", rec.workflow)?.name || "Approval"; c.title = c.workflow; c.name = pname(rec.by); c.owner = rec.by; }
    if (c.title == null) c.title = rec.name || "";
    return c;
  }
  const recTitle = c => String(c.title || c.name || "record");
  const MONEY_KEYS = new Set(["amount", "value", "price", "total"]);
  const fill = (tpl, c) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) =>
    k === "who" ? pname(c.owner || c.assignee || c.by) : MONEY_KEYS.has(k) && c[k] !== "" && c[k] != null && !isNaN(+c[k]) ? Apps.money(c[k]) : k === "date" && /^\d{4}-\d{2}-\d{2}$/.test(c[k] || "") ? Apps.fmtDate(c[k]) : String(c[k] ?? ""));
  function condsOk(rule, c) {
    return (rule.conds || []).filter(x => x && x.field).every(x => {
      const a = c[x.field], b = x.value;
      if (x.op === "gt") return +a > +b;
      if (x.op === "lt") return +a < +b;
      if (x.op === "contains") return low(a).includes(low(b));
      const eq = low(a) === low(b) || (x.field === "stage" && low(c.stageId) === low(b));
      return x.op === "ne" ? !eq : eq;
    });
  }
  const OPS = { eq: "=", ne: "≠", gt: ">", lt: "<", contains: "contains" };
  function condLabel(trigger, cd) {
    const f = (TFIELDS[TRIGGERS[trigger]?.col] || []).find(x => x[0] === cd.field);
    const val = f?.[2] === "person" ? pname(cd.value) : f?.[2] === "number" && MONEY_KEYS.has(cd.field) ? Apps.money(cd.value) : cd.value;
    return `${(f?.[1] || cd.field).toLowerCase()} ${OPS[cd.op] || "="} ${val}`;
  }
  function channels() {
    const out = [{ id: "general", name: "general" }];
    Data.list("channels").filter(c => c.id !== "general" && (!c.private || (c.members || []).includes(me()))).sort(byName).forEach(c => out.push({ id: c.id, name: c.name || "channel" }));
    return out;
  }
  const chName = id => "#" + (channels().find(c => c.id === id)?.name || id);
  const linkFor = (col, rec) => !rec?.id ? "" : ["deals", "leads", "contacts", "companies"].includes(col) ? `#/app/crm/open:${col}:${rec.id}` : col === "tasks" ? "#/app/tasks/" + rec.id
    : col === "bookings" ? "#/app/booking/" + rec.id : col === "quotes" ? "#/app/crm/invoices" : col === "products" ? "#/app/inventory/stock" : col === "wfruns" ? "#/app/automation/run:" + rec.id : col === "absences" ? "#/app/company" : "";
  function resolveWho(rule, c) {
    const w = rule.who || "owner", cur = me(), resp = c.owner || c.assignee || c.by || cur;
    if (w === "me") return rule.by || cur;
    if (w === "owner") return resp;
    if (w === "trigger") return cur;
    if (w === "manager") return managerOf(resp);
    return w;
  }
  function actLabel(r) {
    const a = ACTIONS[r.action]; if (!a) return r.action;
    if (r.action === "post_chat") return "Message " + chName(r.channel || "general");
    if (r.action === "deal_stage_set") { const [p, s] = String(r.stageTo || "").split("::"); return "Move to “" + stageName(p, s) + "”"; }
    if (r.action === "start_wf") return "Start “" + (Data.get("workflows", r.workflow)?.name || "approval") + "”";
    if (r.action === "crm_activity") return "Add " + (ACT_TYPES.find(t => t[0] === (r.actType || "call"))?.[1] || "activity").replace(/^\S+\s/, "").toLowerCase();
    return a.label;
  }

  /* ---------- engine ---------- */
  let busy = 0;
  async function act(rule, c, rec) {
    const col = TRIGGERS[rule.trigger].col, text = fill(rule.text, c), who = resolveWho(rule, c), link = linkFor(col, rec);
    switch (rule.action) {
      case "create_task": {
        const id = await Data.add("tasks", { title: text || "Follow up: " + recTitle(c), status: "todo", priority: "normal", assignee: who, deadline: Apps.addDays(Apps.today(), +rule.days || 1), checklist: [], comments: [], auto: rule.id });
        Data.notify(who, `⚡ New task for you: <b>${esc(text || recTitle(c))}</b>`, "#/app/tasks/" + id, rule.name);
        return "Task for " + firstName(who);
      }
      case "notify":
        if (who === me()) await Data.add("notifications", { to: me(), text: "⚡ " + esc(text || recTitle(c)), link, read: false, by: me() });
        else Data.notify(who, "⚡ " + esc(text || recTitle(c)), link, rule.name);
        return "Notified " + firstName(who);
      case "post_chat": { const ch = rule.channel || "general"; await Data.add("chat", { channel: ch, text: "⚡ " + (text || recTitle(c)), reactions: {} }); return "Posted in " + chName(ch); }
      case "post_feed": await Data.add("feed", { kind: "post", text: "⚡ " + (text || recTitle(c)), likes: [], comments: [] }); return "Posted on the Feed";
      case "assign": {
        if (!rec.id || !["deals", "leads", "tasks"].includes(col)) throw new Error("This record can't be assigned");
        await Data.update(col, rec.id, { [col === "tasks" ? "assignee" : "owner"]: who });
        Data.notify(who, `⚡ You're now responsible for <b>${esc(recTitle(c))}</b>`, link, rule.name);
        return "Assigned to " + firstName(who);
      }
      case "deal_stage_set": {
        if (col !== "deals" || !rec.id) throw new Error("Only works with deal triggers");
        const [pid, sid] = String(rule.stageTo || "").split("::"); if (!sid) throw new Error("No stage chosen");
        const sem = stagesOf(pid).find(s => s.id === sid)?.sem || "process";
        await Data.update("deals", rec.id, { stage: sid, ...(pid ? { pipeline: pid } : {}), closedAt: sem !== "process" ? Date.now() : null });
        return "Moved to " + stageName(pid, sid);
      }
      case "crm_activity": {
        if (!rec.id || !["deals", "leads"].includes(col)) throw new Error("Only works with CRM triggers");
        await Data.add("activities", { type: rule.actType || "call", subject: text || "Follow up", desc: "", due: Date.now() + (+rule.days || 1) * DAY, done: false, owner: who, entity: { col, id: rec.id } });
        Data.notify(who, `📞 New ${esc(rule.actType || "call")} planned: <b>${esc(text || recTitle(c))}</b>`, link, rule.name);
        return "Activity for " + firstName(who);
      }
      case "start_wf": {
        const wf = Data.get("workflows", rule.workflow); if (!wf) throw new Error("The approval template was deleted");
        const values = {}; (wf.fields || []).forEach(f => { if (c[f.key] != null && f.type !== "file") values[f.key] = c[f.key]; });
        await startRun(wf.id, values, { about: text || recTitle(c), src: { col, id: rec.id || "" } });
        return "Started " + wf.name;
      }
    }
    throw new Error("Unknown action");
  }
  async function run(trigger, rec, extra = {}) {
    if (window.Prefs && !Prefs.tool("automation", "rules")) return; // rules switched off in Settings → Tools
    const t = TRIGGERS[trigger]; if (!t) return;
    const rules = Data.list("rules").filter(r => r.enabled !== false && r.trigger === trigger);
    if (!rules.length) return;
    const c = ctxOf(trigger, rec);
    for (const rule of rules) {
      if (t.needsStage && !(rule.stage === extra.stage && (!rule.pipeline || rule.pipeline === (rec.pipeline || "default")))) continue;
      if (!condsOk(rule, c)) continue;
      let ok = true, note = "";
      busy++;
      try { note = await act(rule, c, rec) || ""; } catch (e) { ok = false; note = e?.message || String(e); console.error("automation", e); }
      finally { busy--; }
      const cur = Data.get("rules", rule.id) || rule;
      const log = [{ at: Date.now(), ok, title: recTitle(c).slice(0, 80), by: me(), note: String(note).slice(0, 120) }, ...(cur.log || [])].slice(0, 20);
      busy++;
      try { await Data.update("rules", rule.id, { runs: (cur.runs || 0) + 1, lastRun: Date.now(), log }); } finally { busy--; }
    }
  }
  function lowStock(doc) {
    const api = window.InventoryAPI; if (!api?.stock) return;
    setTimeout(() => [...new Set((doc.items || []).map(i => i.product).filter(Boolean))].forEach(pid => {
      const p = Data.get("products", pid); if (!p || !p.track || !(+p.minStock > 0)) return;
      let s = 0; try { s = +api.stock(pid) || 0; } catch { return; }
      if (s <= +p.minStock) run("low_stock", { ...p, stock: s });
    }), 400);
  }
  Data.hooks.add((kind, col, after, before) => {
    if (busy || !after) return;          // never trigger on changes made by rules themselves
    if (after.deleted) return;           // the recycle bin doesn't count
    if (col === "tasks" && after.kind === "template") return;
    if (col === "deals" && kind === "add") run("deal_created", after);
    if (col === "deals" && kind === "update" && before && before.stage !== after.stage) run("deal_stage", after, { stage: after.stage });
    if (col === "leads" && kind === "add") { run("lead_created", after); if (after.source === "Web form") run("form_lead", after); }
    if (col === "tasks" && kind === "add" && !after.auto) run("task_created", after);
    if (col === "tasks" && kind === "update" && after.status === "done" && before?.status !== "done") run("task_done", after);
    if (col === "bookings" && kind === "add" && after.kind === "booking") run("booking_created", after);
    if (col === "quotes" && after.kind === "invoice" && after.status === "paid" && (kind === "add" || (before && before.status !== "paid"))) run("invoice_paid", after);
    if (col === "absences" && kind === "add" && after.status === "pending") run("absence_requested", after);
    if (col === "inventory" && after.kind === "doc" && after.status === "done" && (kind === "add" || before?.status !== "done") && ["sale", "writeoff", "transfer"].includes(after.type)) lowStock(after);
    if (col === "wfruns" && kind === "update" && before?.status === "running" && (after.status === "approved" || after.status === "declined")) run("wf_done", after);
  });
  // overdue scan: only the responsible person's device handles each task, so rules fire once
  function scan() {
    const m = me(), t = Apps.today();
    Apps.liveTasks().filter(x => x.deadline && x.deadline < t && x.status !== "done" && !x.overdueFlag && Apps.isMyTask(x, m))
      .forEach(async x => { busy++; try { await Data.update("tasks", x.id, { overdueFlag: true }); } finally { busy--; } run("task_overdue", x); });
  }
  setInterval(scan, 5 * 60000);
  Apps.onWorkspace.add(() => setTimeout(scan, 4000));
  setTimeout(scan, 4000);

  /* ---------- rule editor ---------- */
  function editRule(rule = {}) {
    const isNew = !rule.id;
    const r = JSON.parse(JSON.stringify({ trigger: "deal_created", action: "notify", who: "owner", days: 1, text: "", enabled: true, ...rule }));
    r.conds = Array.isArray(r.conds) ? r.conds : [];
    if (!TRIGGERS[r.trigger]) r.trigger = "deal_created";
    const box = h("div", { class: "au-re" });
    function draw() {
      const t = TRIGGERS[r.trigger], col = t.col, fields = TFIELDS[col] || [];
      const acts = Object.entries(ACTIONS).filter(([, a]) => !a.cols || a.cols.includes(col));
      if (!acts.some(([k]) => k === r.action)) r.action = "notify";
      const a = ACTIONS[r.action];
      const when = [frow("When…", selectEl(TGROUPS.map(([g, ks]) => ({ group: g, items: ks.map(k => [k, TRIGGERS[k].icon + " " + TRIGGERS[k].label]) })), r.trigger, v => { r.trigger = v; r.conds = []; draw(); }))];
      if (t.needsStage) {
        const ps = pipes();
        if (ps.length > 1) when.push(frow("Pipeline", selectEl([["", "Any pipeline"], ...ps.map(p => [p.id, p.name])], r.pipeline || "", v => { r.pipeline = v; draw(); })));
        const ss = r.pipeline ? stagesOf(r.pipeline) : allStages();
        if (!ss.some(s => s.id === r.stage)) r.stage = ss[0]?.id || "";
        when.push(frow("Stage", selectEl(ss.map(s => [s.id, s.name]), r.stage, v => (r.stage = v))));
      }
      const condRows = r.conds.map((cd, i) => {
        const fd = fields.find(f => f[0] === cd.field) || fields[0]; cd.field = fd[0];
        const ops = fd[2] === "number" ? [["gt", "is more than"], ["lt", "is less than"], ["eq", "equals"], ["ne", "is not"]] : [["eq", "is"], ["ne", "is not"], ["contains", "contains"]];
        if (!ops.some(o => o[0] === cd.op)) cd.op = ops[0][0];
        const val = fd[2] === "person" ? selectEl([["", "—"], ...Data.people().map(p => [p.key, p.name])], cd.value || "", v => (cd.value = v)) : textIn(cd, "value", "Value", fd[2] === "number" ? "number" : "text");
        return h("div", { class: "au-cond" }, selectEl(fields.map(f => [f[0], f[1]]), cd.field, v => { cd.field = v; cd.value = ""; draw(); }), selectEl(ops, cd.op, v => (cd.op = v), "au-op"), val,
          h("button", { type: "button", class: "icon-btn xs", title: "Remove", html: UI.icon("x"), onclick: () => { r.conds.splice(i, 1); draw(); } }));
      });
      const then = [frow("Then…", selectEl(acts.map(([k, x]) => [k, x.icon + " " + x.label]), r.action, v => { r.action = v; draw(); }))];
      if (r.action === "deal_stage_set") {
        const ps = pipes(), opts = ps.flatMap(p => (p.stages || []).map(s => [p.id + "::" + s.id, (ps.length > 1 ? p.name + " · " : "") + s.name]));
        if (!opts.some(o => o[0] === r.stageTo)) r.stageTo = opts[0]?.[0] || "";
        then.push(frow("Move to stage", selectEl(opts, r.stageTo, v => (r.stageTo = v))));
      }
      if (r.action === "post_chat") then.push(frow("Channel", selectEl(channels().map(c => [c.id, "#" + c.name]), r.channel || "general", v => (r.channel = v))));
      if (r.action === "crm_activity") then.push(frow("Activity", selectEl(ACT_TYPES, r.actType || "call", v => (r.actType = v))));
      if (r.action === "start_wf") {
        const wfs = Data.list("workflows").filter(w => w.active !== false).sort(byName);
        if (!wfs.length) then.push(h("div", { class: "au-note", text: "Add an approval template on the Approvals tab first." }));
        else { if (!wfs.some(w => w.id === r.workflow)) r.workflow = wfs[0].id; then.push(frow("Approval", selectEl(wfs.map(w => [w.id, (w.icon || "📋") + " " + w.name]), r.workflow, v => (r.workflow = v)))); }
      }
      if (a.text) then.push(frow(a.text, textIn(r, "text", "You can use " + (PH[col] || "{title}"))));
      const half = [];
      if (a.who) half.push(h("div", { class: "f-row half" }, h("span", { text: r.action === "assign" ? "Assign to" : "For" }),
        selectEl([...WHO.filter(w => r.action !== "assign" || w[0] !== "owner"), ...Data.people().map(p => [p.key, p.name])], r.who || "owner", v => (r.who = v))));
      if (a.days) { if (r.days == null || r.days === "") r.days = 1; half.push(h("div", { class: "f-row half" }, h("span", { text: a.days }), textIn(r, "days", "1", "number"))); }
      const sw = h("span", { class: "switch" + (r.enabled !== false ? " on" : ""), onclick: () => { r.enabled = r.enabled === false; sw.classList.toggle("on", r.enabled !== false); } });
      box.replaceChildren(
        frow("Rule name", textIn(r, "name", "e.g. " + t.label.replace("…", "") + " → " + a.label.toLowerCase())),
        h("div", { class: "au-re-sec when" }, h("div", { class: "au-re-h", text: "⚡ When" }), ...when),
        h("div", { class: "au-re-sec if" }, h("div", { class: "au-re-h", text: "🔎 Only if (optional)" }), ...condRows,
          h("button", { type: "button", class: "chip-btn", text: "+ Add condition", onclick: () => { r.conds.push({ field: fields[0]?.[0], op: "", value: "" }); draw(); } })),
        h("div", { class: "au-re-sec then" }, h("div", { class: "au-re-h", text: "🎯 Then" }), ...then, half.length ? h("div", { class: "f-grid" }, ...half) : null),
        h("label", { class: "au-onoff" }, h("span", { text: "Rule is on" }), sw));
    }
    draw();
    designer(isNew ? "New automation rule" : "Edit rule", box, {
      ok: isNew ? "Create rule" : "Save", width: 600,
      onDelete: isNew ? null : () => { Data.remove("rules", rule.id); UI.toast("Rule deleted"); },
      onSave: () => {
        const t = TRIGGERS[r.trigger];
        if (t.needsStage && !r.stage) { UI.toast("Choose a stage"); return false; }
        if (r.action === "deal_stage_set" && !r.stageTo) { UI.toast("Choose a stage to move to"); return false; }
        if (r.action === "start_wf" && !r.workflow) { UI.toast("Choose an approval"); return false; }
        const name = String(r.name || "").trim() || t.label.replace("…", "") + " → " + ACTIONS[r.action].label.toLowerCase();
        const data = { name, trigger: r.trigger, pipeline: r.pipeline || "", stage: r.stage || "", conds: r.conds.filter(c => c.field && String(c.value ?? "").trim() !== ""),
          action: r.action, text: r.text || "", who: r.who || "owner", days: +r.days || 1, channel: r.channel || "", stageTo: r.stageTo || "", actType: r.actType || "", workflow: r.workflow || "", enabled: r.enabled !== false };
        if (isNew) { Data.add("rules", { ...data, runs: 0, log: [] }); UI.toast("⚡ Rule created"); } else { Data.update("rules", rule.id, data); UI.toast("Rule saved"); }
      },
    });
  }
  function showLog(id) {
    livePanel("Run log", ["rules"], body => {
      const r = Data.get("rules", id);
      if (!r) return body.replaceChildren(Apps.empty("🔍", "This rule was deleted."));
      const log = r.log || [];
      body.replaceChildren(
        h("div", { class: "au-ph" }, h("span", { class: "au-ph-ic", text: TRIGGERS[r.trigger]?.icon || "⚡" }), h("div", null, h("h2", { text: r.name || "Rule" }), h("small", { text: `Ran ${r.runs || 0}× in total · the last ${log.length ? log.length : "runs"} are kept` }))),
        log.length ? h("div", { class: "au-log" }, ...log.map(x => h("div", { class: "au-log-row" + (x.ok ? "" : " bad") },
          h("span", { class: "au-log-ic", text: x.ok ? "✓" : "!" }),
          h("div", null, h("b", { text: x.title || "Record" }), h("small", { text: (x.note || (x.ok ? "Done" : "Failed")) + " · " + firstName(x.by) + " · " + UI.timeAgo(x.at) })))))
          : Apps.empty("📜", "This rule hasn't run yet."),
        log.length ? h("button", { class: "btn au-mt", text: "Clear log", onclick: () => Data.update("rules", id, { log: [] }) }) : null);
    });
  }
  function viewRules() {
    const tools = h("div", { class: "app-toolbar au-tools" }, h("div", { class: "au-hint", text: "When something happens, Lumen does the next step for you." }), h("span", { class: "grow" }),
      h("button", { class: "btn primary", text: "+ New rule", onclick: () => editRule() }));
    return { cols: ["rules", "workflows"], tools, draw(box) {
      const rules = Data.list("rules").filter(r => r.trigger).sort((a, b) => (a.at || 0) - (b.at || 0));
      box.replaceChildren(
        h("div", { class: "td-sec", text: "Quick start" }),
        h("div", { class: "presets au-presets" }, ...PRESETS.map((p, i) => h("button", { class: "preset glass", style: { animationDelay: i * 35 + "ms" }, onclick: () => editRule(p) },
          h("span", { class: "pr-ic", text: TRIGGERS[p.trigger].icon + " → " + ACTIONS[p.action].icon }), h("b", { text: p.name })))),
        h("div", { class: "td-sec", text: rules.length ? `Your rules · ${rules.filter(r => r.enabled !== false).length} on` : "Your rules" }),
        rules.length ? h("div", { class: "rules" }, ...rules.map((r, i) => ruleCard(r, i))) : Apps.empty("⚡", "No rules yet. Start from a quick-start template above."));
    } };
  }
  function ruleCard(r, i) {
    const on = r.enabled !== false, t = TRIGGERS[r.trigger];
    const sw = h("span", { class: "switch" + (on ? " on" : ""), title: on ? "Turn off" : "Turn on", onclick: e => { e.stopPropagation(); Data.update("rules", r.id, { enabled: !on }); } });
    const stage = t?.needsStage ? " “" + stageName(r.pipeline, r.stage) + "”" : "";
    const lastBad = (r.log || [])[0]?.ok === false;
    return h("div", { class: "rule glass au-rule" + (on ? "" : " off"), style: { animationDelay: i * 30 + "ms" }, onclick: () => editRule(r) },
      h("div", { class: "rule-flow" }, h("span", { class: "rf when", text: (t?.icon || "⚡") + " " + (t ? t.label.replace("…", "") : r.trigger) + stage }),
        ...(r.conds || []).map(c => h("span", { class: "rf if", text: "if " + condLabel(r.trigger, c) })),
        h("span", { class: "rf-arrow", text: "→" }), h("span", { class: "rf then", text: (ACTIONS[r.action]?.icon || "⚙️") + " " + actLabel(r) })),
      h("div", { class: "rule-meta" }, h("b", { text: r.name || "Untitled rule" }), r.text ? h("small", { text: "“" + r.text + "”" }) : null,
        h("small", { class: lastBad ? "au-err" : "", text: `Ran ${r.runs || 0}×${r.lastRun ? " · last " + UI.timeAgo(r.lastRun) : ""}${lastBad ? " · last run failed" : ""}` })),
      h("button", { class: "chip-btn au-logbtn", text: "📜 Log", title: "Run log", onclick: e => { e.stopPropagation(); showLog(r.id); } }), sw);
  }

  /* =====================================================================
     APPROVALS (business processes): workflows = templates, wfruns = requests
     ===================================================================== */
  const STEP_TYPES = [["approve", "✋ Approval"], ["notify", "🔔 Notification"], ["task", "✅ Task"]];
  const STEP_WHO = [["manager", "Requester's manager"], ["head", "Department head"], ["person", "A specific person"], ["admins", "Admins"], ["requester", "The requester"]];
  const TEMPLATES = [
    { name: "Purchase request", icon: "🛒", desc: "Ask to buy something for work. Your manager and an admin approve it.", fields: [
      { key: "item", label: "What do you need?", type: "text", required: true }, { key: "amount", label: "Estimated cost", type: "number", required: true },
      { key: "vendor", label: "Vendor or link", type: "text" }, { key: "needed", label: "Needed by", type: "date" }, { key: "reason", label: "Why it's needed", type: "text" }],
      steps: [{ type: "approve", who: "manager", label: "Manager approval" }, { type: "approve", who: "admins", label: "Budget approval" }, { type: "task", who: "requester", label: "Place the order: {item}" }] },
    { name: "Expense report", icon: "🧾", desc: "Get money back for something you paid for. Attach the receipt.", fields: [
      { key: "purpose", label: "What was it for?", type: "text", required: true }, { key: "amount", label: "Amount", type: "number", required: true },
      { key: "date", label: "Date", type: "date", required: true }, { key: "category", label: "Category", type: "select", options: ["Travel", "Meals", "Office", "Software", "Other"] },
      { key: "receipt", label: "Receipt", type: "file", required: true }],
      steps: [{ type: "approve", who: "manager", label: "Manager approval" }, { type: "approve", who: "admins", label: "Accounting check" }, { type: "notify", who: "requester", label: "Your expense of {amount} will be paid back soon" }] },
    { name: "General approval", icon: "✅", desc: "Ask your manager to approve anything.", fields: [
      { key: "subject", label: "What needs approval?", type: "text", required: true }, { key: "details", label: "Details", type: "text" },
      { key: "due", label: "Decide by", type: "date" }, { key: "files", label: "Attachments", type: "file" }],
      steps: [{ type: "approve", who: "manager", label: "Manager approval" }] },
  ];
  const wfOf = r => r.snap || Data.get("workflows", r.workflow) || { name: r.name, icon: r.icon, fields: [], steps: [] };
  const runLink = id => "#/app/automation/run:" + id;
  const stepsText = w => (w.steps || []).map(s => s.type === "approve" ? "✋ " + (s.label || STEP_WHO.find(x => x[0] === s.who)?.[1] || "Approval") : s.type === "task" ? "✅ Task" : "🔔 Note").join(" → ");
  function stepPeople(step, run) {
    const by = run.by;
    if (step.who === "requester") return [by];
    if (step.who === "person") return step.person ? [step.person] : admins();
    if (step.who === "admins") return admins();
    if (step.who === "head") return [headOf(Data.person(by).dept) || managerOf(by)];
    return [managerOf(by)];
  }
  const fillRun = (tpl, run, wf) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "name") return pname(run.by); if (k === "workflow") return wf.name || "";
    const f = (wf.fields || []).find(x => x.key === k); return f ? plain(f, run.values?.[k]) : "";
  });
  const pending = () => Data.list("wfruns").filter(r => r.status === "running" && (r.waiting || []).includes(me()));

  // run automatic steps from `from` until the next approval (or the end); one run update
  async function advance(run, from, patch = {}) {
    const wf = wfOf(run), steps = wf.steps || [], link = runLink(run.id), name = wf.name || run.name || "Approval", pv = preview(wf.fields, run.values) || run.about || "";
    for (let i = from; i < steps.length; i++) {
      const s = steps[i], ppl = [...new Set(stepPeople(s, run).filter(Boolean))];
      if (s.type === "approve") {
        await Data.update("wfruns", run.id, { ...patch, step: i, waiting: ppl, status: "running" });
        notifyMany(ppl, `📝 <b>${esc(pname(run.by))}</b> needs your approval: ${esc(name)}`, link, pv);
        return;
      }
      const label = fillRun(s.label, run, wf);
      if (s.type === "notify") notifyMany(ppl, `🔔 ${esc(name)}: ${esc(label || "for your information")}`, link, pv);
      if (s.type === "task") for (const k of ppl.slice(0, 5)) {
        const tid = await Data.add("tasks", { title: label || name + ": follow up", desc: pv, status: "todo", priority: "normal", assignee: k, deadline: Apps.addDays(Apps.today(), 2), checklist: [], comments: [], wfrun: run.id });
        Data.notify(k, `✅ New task from ${esc(name)}: <b>${esc(label || "follow up")}</b>`, "#/app/tasks/" + tid, pv);
      }
    }
    await Data.update("wfruns", run.id, { ...patch, step: steps.length, waiting: [], status: "approved", finishedAt: Date.now() });
    if (run.by !== me()) Data.notify(run.by, `✅ Your request was approved: <b>${esc(name)}</b>`, link, pv);
  }
  async function startRun(wfId, values = {}, extra = {}) {
    const wf = Data.get("workflows", wfId);
    if (!wf) { UI.toast("That process no longer exists"); return null; }
    const snap = { name: wf.name, icon: wf.icon || "📋", fields: wf.fields || [], steps: (wf.steps || []).map(s => ({ ...s })) };
    const run = { workflow: wfId, name: wf.name, icon: wf.icon || "📋", values, status: "running", step: 0, decisions: [], waiting: [], snap, ...extra };
    const id = await Data.add("wfruns", run);
    await advance({ ...run, id, by: run.by || me() }, 0);
    return id;
  }
  async function decide(run, decision, comment = "") {
    const cur = Data.get("wfruns", run.id) || run;
    if (cur.status !== "running") return UI.toast("This request was already decided");
    const wf = wfOf(cur), steps = wf.steps || [], step = steps[cur.step] || {}, name = wf.name || cur.name, link = runLink(cur.id);
    const decisions = [...(cur.decisions || []), { step: cur.step, who: me(), decision, comment: String(comment || "").trim(), at: Date.now() }];
    if (decision === "declined") {
      await Data.update("wfruns", cur.id, { decisions, status: "declined", waiting: [], finishedAt: Date.now() });
      if (cur.by !== me()) Data.notify(cur.by, `❌ <b>${esc(Data.me().name)}</b> declined your request: ${esc(name)}`, link, comment || preview(wf.fields, cur.values));
      UI.toast("Request declined"); return;
    }
    const more = steps.slice(cur.step + 1).some(s => s.type === "approve");
    if (cur.by !== me() && more) Data.notify(cur.by, `👍 <b>${esc(Data.me().name)}</b> approved “${esc(step.label || "a step")}” of your request: ${esc(name)}`, link, comment || "Next: " + (steps.slice(cur.step + 1).find(s => s.type === "approve")?.label || "next approval"));
    await advance({ ...cur, decisions }, cur.step + 1, { decisions });
    UI.toast("👍 Approved");
  }
  async function cancelRun(r) {
    if (!(await UI.confirm("Withdraw this request?", "Withdraw"))) return;
    await Data.update("wfruns", r.id, { status: "cancelled", waiting: [], finishedAt: Date.now() });
    notifyMany(r.waiting, `↩️ <b>${esc(pname(r.by))}</b> withdrew a request: ${esc(r.name || "approval")}`, runLink(r.id));
    UI.toast("Request withdrawn");
  }
  function chooseWorkflow(list) {
    return new Promise(res => {
      let done = false;
      const m = UI.modal("Start a process", h("div", { class: "au-choose" }, ...list.map((w, i) => h("button", { class: "au-choice glass", style: { animationDelay: i * 30 + "ms" }, onclick: () => { done = true; m.close(); res(w); } },
        h("span", { class: "au-ch-ic", text: w.icon || "📋" }), h("span", { class: "au-ch-t" }, h("b", { text: w.name }), h("small", { text: w.desc || stepsText(w) }))))), { onClose: () => !done && res(null) });
      m.el.style.width = "520px"; m.el.classList.add("au-modal");
    });
  }
  async function startDialog(wfId) {
    let wf = wfId ? Data.get("workflows", wfId) : null;
    if (!wf) {
      const list = Data.list("workflows").filter(w => w.active !== false).sort(byName);
      if (!list.length) { UI.toast(isAdmin() ? "Add an approval template first (Approvals → Templates)" : "No processes yet. Ask an admin to add one."); return null; }
      wf = list.length === 1 ? list[0] : await chooseWorkflow(list);
      if (!wf) return null;
    }
    const v = await fieldForm((wf.icon || "📋") + " " + wf.name, wf.fields || [], {}, { ok: "Send for approval", intro: wf.desc ? h("p", { class: "au-intro", text: wf.desc }) : null });
    if (!v) return null;
    const id = await startRun(wf.id, v);
    if (id) UI.toast("📨 Sent: " + wf.name, { label: "Open", run: () => openRun(id) });
    return id;
  }
  function statusPill(r) {
    const map = { running: ["orange", "⏳ " + ((r.waiting || []).length ? "Waiting for " + firstName(r.waiting[0]) + ((r.waiting.length > 1) ? " +" + (r.waiting.length - 1) : "") : "In progress")], approved: ["green", "✓ Approved"], declined: ["red", "✕ Declined"], cancelled: ["gray", "Withdrawn"] };
    const [c, t] = map[r.status] || map.running;
    return h("span", { class: "au-pill", style: { "--pc": cvar(c) }, text: t });
  }
  function progressDots(r, steps) {
    const ap = steps.map((s, i) => [s, i]).filter(([s]) => s.type === "approve");
    if (!ap.length) return null;
    return h("span", { class: "au-dots" }, ...ap.map(([s, i]) => {
      const d = (r.decisions || []).filter(x => x.step === i).pop();
      const cls = d ? (d.decision === "approved" ? "ok" : "bad") : r.status === "running" && r.step === i ? "cur" : r.status === "approved" ? "ok" : "";
      return h("i", { class: cls, title: s.label || "Approval" });
    }));
  }
  function runCard(r, i, quick) {
    const wf = wfOf(r), steps = wf.steps || [];
    return h("div", { class: "au-run-card glass", style: { animationDelay: i * 30 + "ms" }, onclick: () => openRun(r.id) },
      h("span", { class: "au-rc-ic", text: r.icon || wf.icon || "📋" }),
      h("div", { class: "au-rc-main" }, h("b", { text: r.name || wf.name || "Approval" }), h("small", { text: preview(wf.fields, r.values) || r.about || "" }), progressDots(r, steps)),
      h("div", { class: "au-rc-side" }, statusPill(r), h("span", { class: "au-rc-by" }, Apps.avatar(Data.person(r.by), 20), h("small", { text: firstName(r.by) + " · " + UI.timeAgo(r.at) })),
        quick ? h("span", { class: "au-rc-quick" },
          h("button", { class: "btn", text: "Decline…", onclick: e => { e.stopPropagation(); openRun(r.id); } }),
          h("button", { class: "btn primary", text: "Approve", onclick: e => { e.stopPropagation(); e.currentTarget.disabled = true; decide(r, "approved"); } })) : null));
  }
  function openRun(id) {
    livePanel("Request", ["wfruns"], (body, panel) => {
      const r = Data.get("wfruns", id);
      if (!r) return body.replaceChildren(Apps.empty("🔍", "This request was not found. It may have been deleted."));
      const wf = wfOf(r), steps = wf.steps || [], mine = r.status === "running" && (r.waiting || []).includes(me());
      const timeline = h("div", { class: "timeline au-tl" },
        h("div", { class: "tl-item" }, h("span", { class: "tl-ic", text: "📨" }), h("div", null, h("b", { text: pname(r.by) + " sent the request" }), h("small", { class: "au-dim", text: " · " + UI.timeAgo(r.at) }))),
        ...steps.map((s, i) => {
          const ds = (r.decisions || []).filter(x => x.step === i), d = ds[ds.length - 1];
          const passed = r.status !== "running" ? (r.status === "approved" || i < r.step) : i < r.step;
          let ic = "○", txt = s.type === "approve" ? "Waiting" : "Next", cls = "next";
          if (d) { ic = d.decision === "approved" ? "✓" : "✕"; cls = d.decision === "approved" ? "ok" : "bad"; txt = (d.decision === "approved" ? "Approved by " : "Declined by ") + pname(d.who) + " · " + UI.timeAgo(d.at); }
          else if (r.status === "running" && r.step === i) { ic = "⏳"; cls = "cur"; txt = "Waiting for " + (r.waiting || []).map(pname).join(", "); }
          else if (passed && s.type !== "approve") { ic = s.type === "task" ? "✅" : "🔔"; cls = "ok"; txt = "Done"; }
          else if (r.status === "declined" || r.status === "cancelled") { txt = "Skipped"; }
          return h("div", { class: "tl-item au-tl-" + cls }, h("span", { class: "tl-ic", text: ic }),
            h("div", null, h("b", { text: (STEP_TYPES.find(x => x[0] === s.type)?.[1] || "") + " · " + (fillRun(s.label, r, wf) || "Step " + (i + 1)) }), h("div", { class: "au-dim", text: txt }),
              d?.comment ? h("div", { class: "au-quote", text: "“" + d.comment + "”" }) : null));
        }),
        r.status !== "running" ? h("div", { class: "tl-item" }, h("span", { class: "tl-ic", text: r.status === "approved" ? "🎉" : r.status === "declined" ? "❌" : "↩️" }),
          h("div", null, h("b", { text: r.status === "approved" ? "Approved" : r.status === "declined" ? "Declined" : "Withdrawn" }), r.finishedAt ? h("small", { class: "au-dim", text: " · " + UI.timeAgo(r.finishedAt) + " · took " + dur(r.finishedAt - r.at) }) : null)) : null);
      let decideBox = null;
      if (mine) {
        const cm = h("textarea", { class: "menu-input au-cmt", rows: 2, placeholder: "Comment (optional)" });
        decideBox = h("div", { class: "au-decide glass" }, h("b", { text: "Your decision" }), cm, h("div", { class: "au-acts" },
          h("button", { class: "btn danger", text: "Decline", onclick: async e => { const b = e.currentTarget; if (!cm.value.trim() && !(await UI.confirm("Decline without a comment?", "Decline"))) return; b.disabled = true; await decide(r, "declined", cm.value); } }),
          h("button", { class: "btn primary", text: "Approve", onclick: async e => { e.currentTarget.disabled = true; await decide(r, "approved", cm.value); } })));
      }
      body.replaceChildren(
        h("div", { class: "au-ph" }, h("span", { class: "au-ph-ic", text: r.icon || wf.icon || "📋" }), h("div", null, h("h2", { text: r.name || wf.name || "Approval" }),
          h("div", { class: "au-ph-sub" }, statusPill(r), Apps.avatar(Data.person(r.by), 20), h("small", { text: pname(r.by) + " · " + (Apps.fmtDateTime?.(r.at) ?? new Date(r.at).toLocaleString()) })))),
        r.about ? h("div", { class: "au-quote", text: r.about }) : null,
        decideBox,
        h("div", { class: "td-sec", text: "Details" }), valuesGrid(wf.fields, r.values),
        h("div", { class: "td-sec", text: "Progress" }), timeline,
        h("div", { class: "au-acts au-mt" },
          r.status === "running" && r.by === me() ? h("button", { class: "btn", text: "Withdraw request", onclick: () => cancelRun(r) }) : null,
          isAdmin() ? h("button", { class: "btn danger", text: "Delete", onclick: async () => { if (await UI.confirm("Delete this request for everyone?")) { panel.close(); Data.remove("wfruns", r.id); UI.toast("Request deleted"); } } }) : null));
    });
  }
  function editWorkflow(wf = {}) {
    const isNew = !wf.id;
    const w = JSON.parse(JSON.stringify({ name: "", icon: "📋", desc: "", fields: [], steps: [{ id: uid(), type: "approve", who: "manager", label: "Manager approval" }], active: true, ...wf }));
    const stepsBox = h("div", { class: "au-steps-ed" });
    const drawSteps = () => stepsBox.replaceChildren(...w.steps.map((s, i) => {
      const whoOpts = STEP_WHO.filter(x => s.type !== "approve" || x[0] !== "requester");
      if (!whoOpts.some(x => x[0] === s.who)) s.who = whoOpts[0][0];
      const pb = s.who === "person" ? h("button", { type: "button", class: "chip-btn", onclick: () => Apps.personPicker(pb, p => { s.person = p ? p.key : ""; drawSteps(); }) }, s.person ? Apps.avatar(Data.person(s.person), 18) : null, h("span", { text: s.person ? pname(s.person) : "Choose…" })) : null;
      return h("div", { class: "au-step-row" }, h("span", { class: "au-step-n", text: i + 1 }),
        selectEl(STEP_TYPES, s.type, v => { s.type = v; drawSteps(); }), selectEl(whoOpts, s.who, v => { s.who = v; drawSteps(); }), pb,
        textIn(s, "label", s.type === "approve" ? "Step name" : s.type === "task" ? "Task title, e.g. Order {item}" : "Message"),
        ...mvBtns(w.steps, i, drawSteps), delBtn(w.steps, i, drawSteps, 1));
    }), h("button", { type: "button", class: "chip-btn", text: "+ Add step", onclick: () => { w.steps.push({ id: uid(), type: "approve", who: "admins", label: "" }); drawSteps(); } }));
    drawSteps();
    const sw = h("span", { class: "switch" + (w.active !== false ? " on" : ""), onclick: () => { w.active = w.active === false; sw.classList.toggle("on", w.active !== false); } });
    designer(isNew ? "New approval template" : "Edit approval template", h("div", null,
      h("div", { class: "au-name-row" }, emojiBtn(w), textIn(w, "name", "Template name, e.g. Purchase request")),
      frow("Description", textIn(w, "desc", "What is it for?")),
      sec("Form fields", fieldsEditor(w.fields)),
      sec("Steps", h("div", { class: "au-hint", text: "Approvals wait for a decision. Notifications and tasks happen right away. Use {field key} or {name} in texts." }), stepsBox),
      h("label", { class: "au-onoff" }, h("span", { text: "Available to start" }), sw)), {
      ok: isNew ? "Create template" : "Save",
      onDelete: isNew ? null : () => { Data.remove("workflows", wf.id); UI.toast("Template deleted"); },
      deleteAsk: "Delete this template? Requests already sent keep working.",
      onSave: () => {
        if (!String(w.name).trim()) { UI.toast("Give the template a name"); return false; }
        const steps = w.steps.map(s => ({ id: s.id || uid(), type: s.type, who: s.who, ...(s.who === "person" ? { person: s.person || "" } : {}), label: String(s.label || "").trim() }));
        if (!steps.length) { UI.toast("Add at least one step"); return false; }
        const data = { name: w.name.trim(), icon: w.icon || "📋", desc: w.desc || "", fields: cleanFields(w.fields), steps, active: w.active !== false };
        if (isNew) Data.add("workflows", data); else Data.update("workflows", wf.id, data);
        UI.toast(isNew ? "📋 Template created" : "Template saved");
      },
    });
  }
  async function addTemplates() {
    const have = new Set(Data.list("workflows").map(w => low(w.name)));
    const todo = TEMPLATES.filter(t => !have.has(low(t.name)));
    for (const t of todo) await Data.add("workflows", { ...JSON.parse(JSON.stringify(t)), steps: t.steps.map(s => ({ id: uid(), ...s })), active: true });
    UI.toast(todo.length ? `✨ Added ${plural(todo.length, "template")}` : "Templates are already here");
  }
  function viewApprovals(st) {
    const tools = h("div", { class: "app-toolbar au-tools" }, h("div", { class: "au-hint", text: "Send requests for approval and decide on others'." }), h("span", { class: "grow" }),
      h("button", { class: "btn primary", text: "📝 Start a process", onclick: () => startDialog() }));
    const view = { cols: ["workflows", "wfruns"], tools, draw(box) {
      const adm = isAdmin(), wfs = Data.list("workflows").sort(byName), runs = Data.list("wfruns").sort((a, b) => (b.at || 0) - (a.at || 0)), mineN = pending().length;
      const subs = [["mine", "Waiting for me", mineN], ["requests", "My requests"], ...(adm ? [["all", "All requests"], ["templates", "Templates"]] : [])];
      if (!subs.some(s => s[0] === st.ap)) st.ap = "mine";
      const seg = h("div", { class: "seg au-seg" }, ...subs.map(([k, l, n]) => h("button", { class: st.ap === k ? "on" : "", onclick: () => { st.ap = k; LS.set("ap", k); view.draw(box); } }, l, n ? h("span", { class: "au-count", text: n }) : null)));
      const out = [seg];
      if (!wfs.length) {
        out.push(adm ? h("div", { class: "au-setup glass" }, h("div", { class: "au-setup-ic", text: "📋" }), h("h3", { text: "Start with ready-made approvals" }),
          h("p", { text: "Add three templates you can change later. Your team can start them right away." }),
          h("div", { class: "au-setup-tiles" }, ...TEMPLATES.map(t => h("div", { class: "au-tile" }, h("span", { text: t.icon }), h("b", { text: t.name }), h("small", { text: stepsText(t) })))),
          h("div", { class: "au-acts" }, h("button", { class: "btn", text: "Build my own", onclick: () => editWorkflow() }), h("button", { class: "btn primary", text: "✨ Add templates", onclick: e => { e.currentTarget.disabled = true; addTemplates(); } })))
          : Apps.empty("📋", "No approval processes yet. Ask an admin to add some."));
        if (st.ap !== "templates") return box.replaceChildren(...out);
      }
      const active = wfs.filter(w => w.active !== false);
      const starts = active.length && (st.ap === "mine" || st.ap === "requests") ? h("div", { class: "au-starts" }, ...active.map((w, i) => h("button", { class: "au-start glass", style: { animationDelay: i * 30 + "ms" }, title: w.desc || "", onclick: () => startDialog(w.id) },
        h("span", { class: "au-st-ic", text: w.icon || "📋" }), h("span", { text: w.name })))) : null;
      if (starts) out.push(h("div", { class: "td-sec", text: "Start a process" }), starts);
      const list = (rs, emptyText, quick) => rs.length ? h("div", { class: "au-runs" }, ...rs.map((r, i) => runCard(r, i, quick))) : Apps.empty("🎉", emptyText);
      if (st.ap === "mine") out.push(h("div", { class: "td-sec", text: "Waiting for your decision" }), list(pending().sort((a, b) => (a.at || 0) - (b.at || 0)), "Nothing is waiting for you.", true));
      if (st.ap === "requests") out.push(h("div", { class: "td-sec", text: "Your requests" }), list(runs.filter(r => r.by === me()), "You haven't sent any requests yet."));
      if (st.ap === "all") {
        st.apStatus = st.apStatus || "all";
        const counts = s => s === "all" ? runs.length : runs.filter(r => r.status === s).length;
        out.push(h("div", { class: "counters au-counters" }, ...[["all", "All", "blue"], ["running", "Open", "orange"], ["approved", "Approved", "green"], ["declined", "Declined", "red"], ["cancelled", "Withdrawn", ""]].map(([k, l, c]) =>
          h("button", { class: "counter" + (st.apStatus === k ? " on" : ""), dataset: { c }, onclick: () => { st.apStatus = k; view.draw(box); } }, h("b", { text: counts(k) }), l))),
        list(runs.filter(r => st.apStatus === "all" || r.status === st.apStatus), "No requests here."));
      }
      if (st.ap === "templates") {
        out.push(h("div", { class: "app-toolbar" }, h("span", { class: "grow" }),
          TEMPLATES.some(t => !wfs.some(w => low(w.name) === low(t.name))) ? h("button", { class: "btn", text: "✨ Add ready templates", onclick: e => { e.currentTarget.disabled = true; addTemplates(); } }) : null,
          h("button", { class: "btn primary", text: "+ New template", onclick: () => editWorkflow() })));
        if (wfs.length) out.push(h("div", { class: "au-grid" }, ...wfs.map((w, i) => {
          const sw = h("span", { class: "switch" + (w.active !== false ? " on" : ""), title: "Available to start", onclick: e => { e.stopPropagation(); Data.update("workflows", w.id, { active: w.active === false }); } });
          const n = runs.filter(r => r.workflow === w.id).length;
          return h("div", { class: "au-card-big glass" + (w.active === false ? " off" : ""), style: { animationDelay: i * 30 + "ms" }, onclick: () => editWorkflow(w) },
            h("div", { class: "au-cb-top" }, h("span", { class: "au-cb-ic", text: w.icon || "📋" }), sw), h("b", { text: w.name }), h("small", { text: w.desc || "" }),
            h("div", { class: "au-cb-flow", text: stepsText(w) }), h("div", { class: "au-cb-foot", text: plural((w.fields || []).length, "field") + " · " + plural(n, "request") }));
        })));
      }
      box.replaceChildren(...out);
    } };
    return view;
  }

  /* =====================================================================
     RPA: processes with stages, items move through them
     ===================================================================== */
  const PROC_EX = [
    { name: "Hiring", icon: "🧑‍💼", desc: "Track candidates from application to offer.", fields: [
      { key: "position", label: "Position", type: "text", required: true }, { key: "email", label: "Email", type: "text" }, { key: "cv", label: "CV", type: "file" },
      { key: "interview", label: "Interview date", type: "date" }, { key: "salary", label: "Offered salary", type: "number" }],
      stages: [{ id: "applied", name: "Applied", color: "blue", fields: ["position"] }, { id: "interview", name: "Interview", color: "purple", fields: ["interview"] }, { id: "offer", name: "Offer", color: "orange", fields: ["salary"] }, { id: "hired", name: "Hired", color: "green" }], done: "hired" },
    { name: "Customer onboarding", icon: "🤝", desc: "Get new customers set up and running.", fields: [
      { key: "customer", label: "Customer", type: "text", required: true }, { key: "plan", label: "Plan", type: "select", options: ["Basic", "Pro", "Enterprise"] },
      { key: "kickoff", label: "Kick-off date", type: "date" }, { key: "trained", label: "Team trained", type: "checkbox" }],
      stages: [{ id: "kickoff", name: "Kick-off", color: "blue", fields: ["kickoff"] }, { id: "setup", name: "Setup", color: "purple" }, { id: "training", name: "Training", color: "orange", fields: ["trained"] }, { id: "live", name: "Live", color: "green" }], done: "live" },
  ];
  const procItems = pid => Data.list("procitems").filter(i => i.process === pid && !i.deleted);
  const finalOf = p => p.done && (p.stages || []).some(s => s.id === p.done) ? p.done : (p.stages || [])[(p.stages || []).length - 1]?.id;
  const stageIn = (p, sid) => (p.stages || []).find(s => s.id === sid) || (p.stages || [])[0] || { id: "", name: "—", color: "gray" };
  const sinceStage = it => { const hs = it.history || []; return hs.length ? hs[hs.length - 1].at : (it.at || Date.now()); };
  function stageTimes(it, now = Date.now()) {
    const hs = ((it.history && it.history.length) ? it.history : [{ stage: it.stage, at: it.at || now }]).slice().sort((a, b) => a.at - b.at), out = {};
    hs.forEach((x, i) => { const end = hs[i + 1]?.at ?? now; out[x.stage] = (out[x.stage] || 0) + Math.max(0, end - x.at); });
    return out;
  }
  const missingFor = (p, it) => (stageIn(p, it.stage).fields || []).map(k => (p.fields || []).find(f => f.key === k)).filter(f => f && isEmpty((it.values || {})[f.key]));
  async function editItemValues(it, p) {
    const v = await fieldForm(p.icon + " " + (it.title || "Item"), [{ key: "__title", label: "Title", type: "text", required: true }, ...(p.fields || [])], { ...(it.values || {}), __title: it.title });
    if (!v) return false;
    const { __title, ...values } = v;
    await Data.update("procitems", it.id, { title: __title.trim(), values });
    return true;
  }
  async function moveItem(it, to, p) {
    if (!it || it.stage === to) return;
    const stages = p.stages || [], from = stageIn(p, it.stage), target = stages.find(s => s.id === to); if (!target) return;
    const need = missingFor(p, it);
    if (need.length && stages.indexOf(target) > stages.indexOf(from)) {
      UI.toast(`Fill in ${need.map(f => f.label).join(", ")} before leaving “${from.name}”`);
      if (await editItemValues(it, p)) { const fresh = Data.get("procitems", it.id); if (fresh && !missingFor(p, fresh).length) return moveItem(fresh, to, p); }
      return;
    }
    const history = [...(it.history || []), { stage: to, by: me(), at: Date.now() }].slice(-60), ppl = target.people || [];
    await Data.update("procitems", it.id, { stage: to, history, ...(ppl.length ? { assignees: ppl } : {}), ...(to === finalOf(p) ? { doneAt: Date.now() } : { doneAt: null }) });
    const link = `#/app/automation/proc:${p.id}:${it.id}`, pv = preview(p.fields, it.values);
    notifyMany(ppl, `🧩 <b>${esc(it.title)}</b> moved to ${esc(target.name)} in ${esc(p.name)}`, link, pv);
    if (to === finalOf(p) && it.by && !ppl.includes(it.by)) Data.notify(it.by, `🏁 <b>${esc(it.title)}</b> reached ${esc(target.name)} in ${esc(p.name)}`, link, pv);
  }
  async function newItem(p) {
    const first = (p.stages || [])[0]; if (!first) return UI.toast("Add stages to this process first");
    const v = await fieldForm("New item · " + p.name, [{ key: "__title", label: "Title", type: "text", required: true }, ...(p.fields || [])], {}, { ok: "Create" });
    if (!v) return;
    const { __title, ...values } = v, ppl = first.people || [];
    const id = await Data.add("procitems", { process: p.id, title: __title.trim(), stage: first.id, values, history: [{ stage: first.id, by: me(), at: Date.now() }], assignees: ppl.length ? ppl : [me()], comments: [] });
    notifyMany(ppl, `🧩 New item in ${esc(p.name)}: <b>${esc(__title)}</b>`, `#/app/automation/proc:${p.id}:${id}`, preview(p.fields, values));
    UI.toast("🧩 Item created");
  }
  function openItem(id) {
    let assignT = 0;
    livePanel("Process item", ["procitems", "processes"], (body, panel) => {
      const it = Data.get("procitems", id), p = it && Data.get("processes", it.process);
      if (!it || !p || it.deleted) return body.replaceChildren(Apps.empty("🔍", "This item was not found."));
      const stages = p.stages || [], cur = stageIn(p, it.stage), ci = stages.indexOf(cur), need = missingFor(p, it);
      const bar = h("div", { class: "au-stagebar" }, ...stages.map((s, i) => h("button", { class: "au-sb" + (i < ci ? " past" : i === ci ? " on" : ""), style: { "--sc": cvar(s.color) }, title: "Move to " + s.name, text: s.name, onclick: () => moveItem(it, s.id, p) })));
      const asg = h("button", { class: "chip-btn", onclick: () => Apps.peoplePicker(asg, it.assignees || [], ks => { clearTimeout(assignT); assignT = setTimeout(() => Data.update("procitems", id, { assignees: ks }), 700); }) },
        (it.assignees || []).length ? Apps.avatars(it.assignees, 20, 5) : null, h("span", { text: (it.assignees || []).length ? (it.assignees || []).map(firstName).join(", ") : "Add people" }));
      const hs = (it.history || []).slice().sort((a, b) => a.at - b.at);
      const cmt = h("input", { class: "menu-input", placeholder: "Write a comment… (@name to mention)" });
      Apps.mentionAssist(cmt);
      cmt.onkeydown = e => {
        if (e.key !== "Enter" || !cmt.value.trim()) return;
        const text = cmt.value.trim(); cmt.value = "";
        Data.arr("procitems", id, "comments", { id: uid(), by: me(), at: Date.now(), text });
        notifyMany([...(it.assignees || []), it.by, ...Apps.mentioned(text)], `💬 <b>${esc(Data.me().name)}</b> commented on ${esc(it.title)}`, `#/app/automation/proc:${p.id}:${id}`, text);
        panel.refresh?.(); setTimeout(() => body.querySelector(".au-cmt-in input")?.focus(), 50);
      };
      body.replaceChildren(
        h("div", { class: "au-ph" }, h("span", { class: "au-ph-ic", text: p.icon || "🧩" }), h("div", null, h("h2", { text: it.title || "Item" }),
          h("div", { class: "au-ph-sub" }, h("span", { class: "au-pill", style: { "--pc": cvar(cur.color) }, text: cur.name }), h("small", { text: p.name + " · in this stage " + dur(Date.now() - sinceStage(it)) })))),
        bar,
        need.length ? h("div", { class: "au-note" }, "Before moving on, fill in: " + need.map(f => f.label).join(", ")) : null,
        h("div", { class: "td-grid" }, h("span", { text: "Responsible" }), h("div", null, asg), h("span", { text: "Created" }), h("span", { text: pname(it.by) + " · " + UI.timeAgo(it.at) })),
        h("div", { class: "au-sec-h" }, h("div", { class: "td-sec", text: "Fields" }), h("button", { class: "chip-btn", text: "✏️ Edit", onclick: () => editItemValues(it, p) })),
        valuesGrid(p.fields, it.values),
        h("div", { class: "td-sec", text: "History" }),
        h("div", { class: "timeline au-tl" }, ...hs.map((x, i) => { const s = stageIn(p, x.stage), end = hs[i + 1]?.at; return h("div", { class: "tl-item" }, h("span", { class: "tl-ic", style: { color: cvar(s.color) }, text: "●" }),
          h("div", null, h("b", { text: (i === 0 ? "Created in " : "Moved to ") + s.name }), h("div", { class: "au-dim", text: pname(x.by) + " · " + UI.timeAgo(x.at) + (end ? " · stayed " + dur(end - x.at) : "") }))); })),
        h("div", { class: "td-sec", text: "Comments" }),
        h("div", { class: "comments" }, ...(it.comments || []).slice().sort((a, b) => a.at - b.at).map(c => h("div", { class: "cmt" }, Apps.avatar(Data.person(c.by), 28),
          h("div", null, h("div", { class: "cmt-h" }, h("b", { text: pname(c.by) }), h("small", { text: UI.timeAgo(c.at) })), h("div", { class: "cmt-t", text: c.text }))))),
        h("div", { class: "au-cmt-in" }, cmt),
        h("div", { class: "au-acts au-mt" }, h("button", { class: "btn danger", text: "Delete item", onclick: async () => {
          if (!(await UI.confirm("Delete this item?"))) return;
          await Data.update("procitems", id, { deleted: true, deletedAt: Date.now() });
          UI.toast("Item deleted", { label: "Undo", run: () => Data.update("procitems", id, { deleted: false }) });
        } })));
    });
  }
  function fieldPick(anchor, fields, selected, onChange) {
    const sel = new Set(selected || []), list = h("div", { class: "pp-list" });
    const draw = () => list.replaceChildren(...(fields.length ? fields.map(f => h("button", { type: "button", class: "mi compact" + (sel.has(f.key) ? " on" : ""), onclick: () => { sel.has(f.key) ? sel.delete(f.key) : sel.add(f.key); onChange([...sel]); draw(); } },
      h("span", { class: "pp-check", text: sel.has(f.key) ? "✓" : "" }), h("span", { class: "mi-t", text: f.label }))) : [h("div", { class: "menu-empty", text: "Add fields first" })]));
    draw();
    UI.popover(anchor, h("div", { style: { width: "260px" } }, h("div", { class: "menu-sec", text: "Must be filled before leaving" }), list));
  }
  function editProcess(proc = {}, onCreated) {
    const isNew = !proc.id;
    const p = JSON.parse(JSON.stringify({ name: "", icon: "🧩", desc: "", fields: [], stages: [
      { id: "s" + uid(), name: "New", color: "blue", people: [], fields: [] }, { id: "s" + uid(), name: "In progress", color: "orange", people: [], fields: [] }, { id: "s" + uid(), name: "Done", color: "green", people: [], fields: [] }], done: "", ...proc }));
    if (!p.stages.some(s => s.id === p.done)) p.done = p.stages[p.stages.length - 1]?.id;
    const radio = "au-final-" + uid(), stBox = h("div", { class: "au-stage-ed" });
    const drawStages = () => stBox.replaceChildren(...p.stages.map((s, i) => {
      const dot = h("button", { type: "button", class: "au-dot", style: { background: cvar(s.color) }, title: "Colour", onclick: () => UI.menu(dot, COLORS.map(c => ({ label: cap(c), iconHtml: `<span class="au-sw" style="background:var(--c-${c})"></span>`, onClick: () => { s.color = c; drawStages(); } }))) });
      const ppl = h("button", { type: "button", class: "chip-btn au-ppl", title: "People responsible in this stage" });
      const paintP = () => ppl.replaceChildren((s.people || []).length ? Apps.avatars(s.people, 18, 3) : h("span", { text: "👤 People" })); paintP();
      ppl.onclick = () => Apps.peoplePicker(ppl, s.people || [], ks => { s.people = ks; paintP(); });
      const req = h("button", { type: "button", class: "chip-btn" });
      const paintR = () => (req.textContent = (s.fields || []).length ? "✱ " + s.fields.length + " required" : "✱ Required"); paintR();
      req.onclick = () => fieldPick(req, p.fields.filter(f => String(f.label || "").trim()), s.fields || [], ks => { s.fields = ks; paintR(); });
      const fin = h("label", { class: "au-final", title: "Final stage" }, h("input", { type: "radio", name: radio, checked: p.done === s.id, onchange: () => (p.done = s.id) }), h("span", { text: "Final" }));
      return h("div", { class: "au-stage-row", style: { "--sc": cvar(s.color) } }, dot, textIn(s, "name", "Stage name"), ppl, req, fin, ...mvBtns(p.stages, i, drawStages), delBtn(p.stages, i, drawStages, 2));
    }), h("button", { type: "button", class: "chip-btn", text: "+ Add stage", onclick: () => { p.stages.splice(Math.max(0, p.stages.length - 1), 0, { id: "s" + uid(), name: "", color: COLORS[(p.stages.length + 2) % COLORS.length], people: [], fields: [] }); drawStages(); } }));
    drawStages();
    designer(isNew ? "New process" : "Process settings", h("div", null,
      h("div", { class: "au-name-row" }, emojiBtn(p), textIn(p, "name", "Process name, e.g. Hiring")),
      frow("Description", textIn(p, "desc", "What does this process track?")),
      sec("Fields", fieldsEditor(p.fields)),
      sec("Stages", h("div", { class: "au-hint", text: "People are notified when an item arrives in their stage. Required fields must be filled before an item moves on." }), stBox)), {
      ok: isNew ? "Create process" : "Save", width: 720,
      onDelete: isNew ? null : () => { Data.remove("processes", proc.id); UI.toast("Process deleted"); },
      deleteAsk: "Delete this process? Its items will no longer be shown.",
      onSave: async () => {
        if (!String(p.name).trim()) { UI.toast("Give the process a name"); return false; }
        const fields = cleanFields(p.fields);
        const stages = p.stages.filter(s => String(s.name || "").trim()).map(s => ({ id: s.id, name: s.name.trim(), color: s.color || "gray", people: s.people || [], fields: (s.fields || []).filter(k => fields.some(f => f.key === k)) }));
        if (stages.length < 2) { UI.toast("Add at least two stages"); return false; }
        const data = { name: p.name.trim(), icon: p.icon || "🧩", desc: p.desc || "", fields, stages, done: stages.some(s => s.id === p.done) ? p.done : stages[stages.length - 1].id };
        if (isNew) { const id = await Data.add("processes", data); onCreated?.(id); } else Data.update("processes", proc.id, data);
        UI.toast(isNew ? "🧩 Process created" : "Process saved");
      },
    });
  }
  async function addProcessExample(x, nav) {
    const data = JSON.parse(JSON.stringify(x));
    data.stages = data.stages.map(s => ({ people: [], fields: [], ...s }));
    const id = await Data.add("processes", data);
    UI.toast(x.icon + " " + x.name + " added"); nav.proc(id);
  }
  function viewRPA(st, nav) {
    if (st.proc) return viewProcess(st, nav);
    const adm = isAdmin();
    const tools = h("div", { class: "app-toolbar au-tools" }, h("div", { class: "au-hint", text: "Move work through stages, like a conveyor belt." }), h("span", { class: "grow" }),
      adm ? h("button", { class: "btn", text: "✨ Add example", onclick: e => UI.menu(e.currentTarget, PROC_EX.map(x => ({ label: x.name, iconHtml: x.icon, onClick: () => addProcessExample(x, nav) })), { align: "end" }) }) : null,
      adm ? h("button", { class: "btn primary", text: "+ New process", onclick: () => editProcess({}, id => nav.proc(id)) }) : null);
    return { cols: ["processes", "procitems"], tools, draw(box) {
      const procs = Data.list("processes").sort(byName);
      if (!procs.length) return box.replaceChildren(Apps.empty("🧩", adm ? "No processes yet. Create one or add an example." : "No processes yet. Ask an admin to set one up.",
        adm ? h("button", { class: "btn primary", text: "+ New process", onclick: () => editProcess({}, id => nav.proc(id)) }) : null));
      box.replaceChildren(h("div", { class: "au-grid" }, ...procs.map((p, i) => {
        const items = procItems(p.id), n = items.length || 1, fin = finalOf(p);
        return h("button", { class: "au-card-big glass", style: { animationDelay: i * 35 + "ms" }, onclick: () => nav.proc(p.id) },
          h("div", { class: "au-cb-top" }, h("span", { class: "au-cb-ic", text: p.icon || "🧩" }), h("span", { class: "au-dim", text: plural(items.length, "item") })),
          h("b", { text: p.name }), h("small", { text: p.desc || (p.stages || []).map(s => s.name).join(" → ") }),
          h("div", { class: "au-mini" }, ...(p.stages || []).map(s => { const c = items.filter(x => (stageIn(p, x.stage).id) === s.id).length; return h("span", { style: { flex: Math.max(c, items.length ? 0.15 : 1) / n, background: cvar(s.color) }, title: s.name + ": " + c }); })),
          h("div", { class: "au-cb-foot", text: `${items.filter(x => x.stage !== fin).length} open · ${items.filter(x => x.stage === fin).length} done` }));
      })));
    } };
  }
  function viewProcess(st, nav) {
    const adm = isAdmin();
    const seg = h("div", { class: "seg" }, ...[["board", "Board"], ["list", "List"], ["stats", "Stats"]].map(([k, l]) => h("button", { class: st.procView === k ? "on" : "", text: l, onclick: e => { st.procView = k; LS.set("procView", k); seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); view.refresh(); } })));
    const search = h("input", { class: "app-search", type: "search", placeholder: "Search items…", oninput: e => { st.q = low(e.target.value); view.refresh(); } });
    const tools = h("div", { class: "app-toolbar au-tools" }, h("button", { class: "btn au-back", text: "← Processes", onclick: () => nav.proc(null) }), seg, search, h("span", { class: "grow" }),
      adm ? h("button", { class: "icon-btn", title: "Process settings", text: "⚙️", onclick: () => { const p = Data.get("processes", st.proc); if (p) editProcess(p); } }) : null,
      h("button", { class: "btn primary", text: "+ New item", onclick: () => { const p = Data.get("processes", st.proc); if (p) newItem(p); } }));
    const view = { cols: ["processes", "procitems"], tools, draw(box) {
      const p = Data.get("processes", st.proc);
      if (!p) return box.replaceChildren(Apps.empty("🔍", "This process was not found.", h("button", { class: "btn", text: "Back to processes", onclick: () => nav.proc(null) })));
      const fin = finalOf(p), stages = p.stages || [];
      let items = procItems(p.id);
      if (st.q) items = items.filter(it => low(it.title).includes(st.q) || (p.fields || []).some(f => low(plain(f, it.values?.[f.key])).includes(st.q)));
      const head = h("div", { class: "au-vh" }, h("span", { class: "au-vh-ic", text: p.icon || "🧩" }), h("div", null, h("h2", { text: p.name }), h("small", { text: p.desc || plural(items.length, "item") })));
      let main;
      if (st.procView === "list") {
        const cols = (p.fields || []).filter(f => f.type !== "file").slice(0, 3);
        main = items.length ? h("div", { class: "au-tablewrap glass" }, h("table", { class: "au-table" },
          h("thead", null, h("tr", null, h("th", { text: "Title" }), h("th", { text: "Stage" }), h("th", { text: "Responsible" }), ...cols.map(f => h("th", { text: f.label })), h("th", { text: "In stage" }))),
          h("tbody", null, ...items.sort((a, b) => sinceStage(b) - sinceStage(a)).map(it => { const s = stageIn(p, it.stage); return h("tr", { onclick: () => openItem(it.id) },
            h("td", null, h("b", { text: it.title || "Untitled" })), h("td", null, h("span", { class: "au-pill", style: { "--pc": cvar(s.color) }, text: s.name })),
            h("td", null, Apps.avatars(it.assignees || [], 20, 3)), ...cols.map(f => h("td", null, show(f, it.values?.[f.key], true))), h("td", { class: "au-dim", text: dur(Date.now() - sinceStage(it)) })); }))))
          : Apps.empty("🧩", st.q ? "Nothing matches your search." : "No items yet. Click “+ New item”.");
      } else if (st.procView === "stats") {
        const all = procItems(p.id), now = Date.now();
        const times = all.map(it => stageTimes(it, now));
        const done = all.filter(x => x.stage === fin), cyc = done.map(x => (x.doneAt || sinceStage(x)) - (x.at || 0)).filter(x => x > 0);
        main = h("div", null, h("div", { class: "au-kpis" }, kpi("Items", all.length), kpi("Open", all.length - done.length, "orange"), kpi("Done", done.length, "green"), kpi("Average time to finish", cyc.length ? dur(mean(cyc)) : "—")),
          h("div", { class: "reports au-reports" },
            h("div", { class: "report glass" }, h("h3", { text: "Items per stage" }), bars(stages.map(s => ({ label: s.name, value: all.filter(x => stageIn(p, x.stage).id === s.id).length, color: s.color })))),
            h("div", { class: "report glass" }, h("h3", { text: "Average time in stage" }), bars(stages.filter(s => s.id !== fin).map(s => { const v = times.map(t => t[s.id]).filter(x => x > 0); const m = mean(v); return { label: s.name, value: m, color: s.color, note: v.length ? dur(m) : "—" }; })))));
      } else {
        main = h("div", { class: "board au-board" }, ...stages.map((s, si) => {
          const its = items.filter(it => stageIn(p, it.stage).id === s.id).sort((a, b) => sinceStage(a) - sinceStage(b));
          const col = h("div", { class: "b-col au-col" + (s.id === fin ? " fin" : ""), style: { "--sc": cvar(s.color), animationDelay: si * 40 + "ms" },
            ondragover: e => { e.preventDefault(); col.classList.add("drop"); }, ondragleave: e => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop"); },
            ondrop: e => { e.preventDefault(); col.classList.remove("drop"); const id = e.dataTransfer.getData("text/plain"); const it = Data.get("procitems", id); if (it && it.process === p.id) moveItem(it, s.id, p); } },
            h("div", { class: "b-col-h au-col-h" }, h("span", { class: "au-col-dot" }), h("b", { text: s.name }), h("span", { class: "n", text: its.length }), s.id === fin ? h("span", { title: "Final stage", text: "🏁" }) : null, h("span", { class: "grow" }),
              (s.people || []).length ? Apps.avatars(s.people, 18, 2) : null),
            ...its.map((it, i) => {
              const pv = preview(p.fields, it.values, 2), miss = missingFor(p, it).length;
              return h("div", { class: "au-card glass", draggable: true, style: { animationDelay: i * 25 + "ms" }, ondragstart: e => { e.dataTransfer.setData("text/plain", it.id); e.dataTransfer.effectAllowed = "move"; }, onclick: () => openItem(it.id) },
                h("b", { text: it.title || "Untitled" }), pv ? h("small", { text: pv }) : null,
                h("div", { class: "au-card-f" }, Apps.avatars(it.assignees || [], 18, 3), h("span", { class: "grow" }), miss && s.id !== fin ? h("span", { class: "au-miss", title: "Fields to fill before moving on", text: "✱ " + miss }) : null,
                  (it.comments || []).length ? h("small", { text: "💬 " + it.comments.length }) : null, h("small", { title: "Time in this stage", text: "⏱ " + dur(Date.now() - sinceStage(it)) })));
            }),
            si === 0 ? h("button", { class: "au-col-add", text: "+ New item", onclick: () => newItem(p) }) : null);
          return col;
        }));
      }
      box.replaceChildren(head, main);
      if (st.item) { const iid = st.item; st.item = null; setTimeout(() => openItem(iid), 60); }
    } };
    return view;
  }

  /* =====================================================================
     LISTS: custom databases
     ===================================================================== */
  const LIST_EX = [
    { name: "Equipment register", icon: "🖥️", desc: "Company laptops, phones and furniture, and who has them.", access: "admins", fields: [
      { key: "item", label: "Item", type: "text", required: true }, { key: "type", label: "Type", type: "select", options: ["Laptop", "Monitor", "Phone", "Furniture", "Other"] },
      { key: "serial", label: "Serial number", type: "text" }, { key: "holder", label: "Assigned to", type: "person" }, { key: "bought", label: "Purchase date", type: "date" },
      { key: "price", label: "Price", type: "number" }, { key: "warranty", label: "Warranty until", type: "date" }, { key: "invoice", label: "Invoice", type: "file" }] },
    { name: "Supplier list", icon: "🏭", desc: "Who we buy from and how to reach them.", access: "all", fields: [
      { key: "supplier", label: "Supplier", type: "text", required: true }, { key: "category", label: "Category", type: "select", options: ["Goods", "Services", "Software", "Logistics"] },
      { key: "contact", label: "Contact person", type: "text" }, { key: "email", label: "Email", type: "text" }, { key: "phone", label: "Phone", type: "text" },
      { key: "website", label: "Website", type: "url" }, { key: "preferred", label: "Preferred", type: "checkbox" }] },
    { name: "Training log", icon: "🎓", desc: "Courses and certificates for the team.", access: "all", fields: [
      { key: "course", label: "Course", type: "text", required: true }, { key: "employee", label: "Employee", type: "person", required: true }, { key: "date", label: "Date", type: "date" },
      { key: "hours", label: "Hours", type: "number" }, { key: "status", label: "Status", type: "select", options: ["Planned", "In progress", "Completed"] },
      { key: "certificate", label: "Certificate", type: "file" }, { key: "link", label: "Course link", type: "url" }] },
  ];
  const canEditList = l => l.access === "admins" ? isAdmin() : true;
  function editList(list = {}, onCreated) {
    const isNew = !list.id;
    const l = JSON.parse(JSON.stringify({ name: "", icon: "🗂️", desc: "", access: "all", fields: [{ key: "f" + uid(), label: "Name", type: "text", required: true }], ...list }));
    const acc = h("div", { class: "seg" }, ...[["all", "Everyone can add and edit"], ["admins", "Only admins edit"]].map(([k, t]) => h("button", { type: "button", class: l.access === k ? "on" : "", text: t, onclick: e => { l.access = k; acc.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    designer(isNew ? "New list" : "List settings", h("div", null,
      h("div", { class: "au-name-row" }, emojiBtn(l), textIn(l, "name", "List name, e.g. Equipment register")),
      frow("Description", textIn(l, "desc", "What do you keep here?")),
      frow("Who can add items", acc),
      sec("Fields", fieldsEditor(l.fields))), {
      ok: isNew ? "Create list" : "Save",
      onDelete: isNew ? null : () => { Data.remove("lists", list.id); UI.toast("List deleted"); },
      deleteAsk: "Delete this list? Its items will no longer be shown.",
      onSave: async () => {
        if (!String(l.name).trim()) { UI.toast("Give the list a name"); return false; }
        const fields = cleanFields(l.fields);
        if (!fields.length) { UI.toast("Add at least one field"); return false; }
        const data = { name: l.name.trim(), icon: l.icon || "🗂️", desc: l.desc || "", access: l.access === "admins" ? "admins" : "all", fields };
        if (isNew) { const id = await Data.add("lists", data); onCreated?.(id); } else Data.update("lists", list.id, data);
        UI.toast(isNew ? "🗂️ List created" : "List saved");
      },
    });
  }
  async function addListItem(l, preset = {}) {
    const v = await fieldForm("New item · " + l.name, l.fields || [], preset, { ok: "Add" });
    if (!v) return null;
    return Data.add("listitems", { list: l.id, values: v, deleted: false });
  }
  function openListItem(l, it) {
    if (!canEditList(l)) {
      const m = UI.modal(l.icon + " " + l.name, h("div", null, valuesGrid(l.fields, it.values), h("div", { class: "au-dim", text: "Added by " + pname(it.by) + " · " + UI.timeAgo(it.at) })));
      m.el.style.width = "520px"; m.el.classList.add("au-modal"); return;
    }
    fieldForm(l.icon + " " + l.name, l.fields || [], it.values || {}, {
      deleteAsk: "Delete this item?", onDelete: () => { Data.update("listitems", it.id, { deleted: true, deletedAt: Date.now() }); UI.toast("Item deleted", { label: "Undo", run: () => Data.update("listitems", it.id, { deleted: false }) }); },
    }).then(v => { if (v) Data.update("listitems", it.id, { values: v }); });
  }
  const csvCell = s => { s = String(s ?? ""); return /[",;\n\r]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csvPlain(f, v) {
    if (f.type === "checkbox") return v ? "yes" : "no";
    if (isEmpty(v)) return "";
    if (f.type === "person") return Data.person(v).email || pname(v);
    if (f.type === "file") return (v || []).map(a => a.name).join("; ");
    return String(v);
  }
  function exportCSV(l, items) {
    const rows = [(l.fields || []).map(f => f.label), ...items.map(it => (l.fields || []).map(f => csvPlain(f, it.values?.[f.key])))];
    const blob = new Blob(["﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const u = URL.createObjectURL(blob), a = h("a", { href: u, download: (l.name || "list").replace(/[\\/:*?"<>|]/g, "") + ".csv" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
  }
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0] || "", sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ""));
  }
  function fromCSV(f, s) {
    s = String(s ?? "").trim(); if (!s) return f.type === "checkbox" ? false : "";
    if (f.type === "number") { const n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? "" : n; }
    if (f.type === "checkbox") return /^(1|yes|y|true|✓|x|on)$/i.test(s);
    if (f.type === "person") { const p = Data.people().find(x => low(x.email) === low(s) || low(x.name) === low(s) || x.key === s); return p ? p.key : ""; }
    if (f.type === "date") { if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const t = Date.parse(s); return isNaN(t) ? "" : Apps.iso(new Date(t)); }
    if (f.type === "file") return [];
    return s;
  }
  async function importCSV(l) {
    const [file] = await Apps.pickFiles(false); if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return UI.toast("That file has no rows to import");
    const head = rows[0].map(low), fields = l.fields || [];
    const map = fields.map(f => head.findIndex(x => x === low(f.label) || x === low(f.key)));
    if (!map.some(i => i >= 0)) return UI.toast("No columns match this list's fields. Use the field names as headers.");
    const data = rows.slice(1, 501);
    if (!(await UI.confirm(`Import ${plural(data.length, "row")} into “${l.name}”? Matching columns: ${fields.filter((f, i) => map[i] >= 0).map(f => f.label).join(", ")}.${rows.length > 501 ? " Only the first 500 rows are imported." : ""}`, "Import"))) return;
    UI.toast("Importing…");
    let n = 0;
    for (const r of data) {
      const values = {}; fields.forEach((f, i) => { if (map[i] >= 0) values[f.key] = fromCSV(f, r[map[i]]); });
      await Data.add("listitems", { list: l.id, values, deleted: false }); n++;
    }
    UI.toast(`✅ Imported ${plural(n, "item")}`);
  }
  function viewLists(st, nav) {
    if (st.list) return viewList(st, nav);
    const adm = isAdmin();
    const tools = h("div", { class: "app-toolbar au-tools" }, h("div", { class: "au-hint", text: "Simple databases for anything your team keeps track of." }), h("span", { class: "grow" }),
      adm ? h("button", { class: "btn", text: "✨ Add example", onclick: e => UI.menu(e.currentTarget, LIST_EX.map(x => ({ label: x.name, iconHtml: x.icon, onClick: async () => { const id = await Data.add("lists", JSON.parse(JSON.stringify(x))); UI.toast(x.icon + " " + x.name + " added"); nav.list(id); } })), { align: "end" }) }) : null,
      adm ? h("button", { class: "btn primary", text: "+ New list", onclick: () => editList({}, id => nav.list(id)) }) : null);
    return { cols: ["lists", "listitems"], tools, draw(box) {
      const lists = Data.list("lists").sort(byName), items = Data.list("listitems").filter(i => !i.deleted);
      if (!lists.length) return box.replaceChildren(Apps.empty("🗂️", adm ? "No lists yet. Create one or add an example." : "No lists yet. Ask an admin to create one.",
        adm ? h("button", { class: "btn primary", text: "+ New list", onclick: () => editList({}, id => nav.list(id)) }) : null));
      box.replaceChildren(h("div", { class: "au-grid" }, ...lists.map((l, i) => {
        const n = items.filter(x => x.list === l.id).length;
        return h("button", { class: "au-card-big glass", style: { animationDelay: i * 35 + "ms" }, onclick: () => nav.list(l.id) },
          h("div", { class: "au-cb-top" }, h("span", { class: "au-cb-ic", text: l.icon || "🗂️" }), l.access === "admins" ? h("span", { class: "au-tag", text: "🔒 Admins edit" }) : null),
          h("b", { text: l.name }), h("small", { text: l.desc || (l.fields || []).map(f => f.label).slice(0, 4).join(", ") }), h("div", { class: "au-cb-foot", text: plural(n, "item") + " · " + plural((l.fields || []).length, "field") }));
      })));
    } };
  }
  function cmpVals(f, a, b) {
    const x = a.values?.[f.key], y = b.values?.[f.key];
    if (isEmpty(x) && !isEmpty(y)) return 1; if (!isEmpty(x) && isEmpty(y)) return -1;
    if (f.type === "number") return (+x || 0) - (+y || 0);
    if (f.type === "checkbox") return (y ? 1 : 0) - (x ? 1 : 0);
    return plain(f, x).localeCompare(plain(f, y), undefined, { numeric: true });
  }
  function viewList(st, nav) {
    const search = h("input", { class: "app-search", type: "search", placeholder: "Search…", oninput: e => { st.q = low(e.target.value); view.refresh(); } });
    const fBtn = h("button", { class: "btn", text: "Filter" });
    const paintF = () => { const n = Object.values(st.lf).filter(v => v !== "" && v != null).length; fBtn.textContent = n ? "Filter · " + n : "Filter"; fBtn.classList.toggle("primary", !!n); };
    fBtn.onclick = () => {
      const l = Data.get("lists", st.list); if (!l) return;
      const ff = (l.fields || []).filter(f => ["select", "person", "checkbox"].includes(f.type));
      if (!ff.length) return UI.toast("Add a list-of-options, person or yes/no field to filter by it");
      UI.popover(fBtn, h("div", { class: "au-filter" }, h("div", { class: "menu-sec", text: "Show only" }), ...ff.map(f => h("label", { class: "f-row" }, h("span", { text: f.label }),
        selectEl([["", "Any"], ...(f.type === "select" ? (f.options || []).map(o => [o, o]) : f.type === "checkbox" ? [["yes", "Yes"], ["no", "No"]] : Data.people().map(p => [p.key, p.name]))], st.lf[f.key] || "", v => { st.lf[f.key] = v; paintF(); view.refresh(); }))),
        h("button", { class: "btn", text: "Clear filters", onclick: () => { st.lf = {}; paintF(); view.refresh(); UI.closePops(); } })));
    };
    const more = h("button", { class: "icon-btn", title: "More", html: UI.icon("dots") });
    more.onclick = () => {
      const l = Data.get("lists", st.list); if (!l) return;
      const items = Data.list("listitems").filter(x => x.list === l.id && !x.deleted).sort((a, b) => (a.at || 0) - (b.at || 0));
      const delN = Data.list("listitems").filter(x => x.list === l.id && x.deleted).length;
      UI.menu(more, [
        { label: "Export CSV", icon: "download", onClick: () => exportCSV(l, items) },
        canEditList(l) ? { label: "Import CSV…", iconHtml: "📥", onClick: () => importCSV(l) } : null,
        { label: st.showDeleted ? "Back to items" : `Deleted items (${delN})`, icon: st.showDeleted ? "arrow" : "trash", onClick: () => { st.showDeleted = !st.showDeleted; view.refresh(); } },
        isAdmin() ? { sep: true } : null,
        isAdmin() ? { label: "List settings…", iconHtml: "⚙️", onClick: () => editList(l) } : null,
      ], { align: "end" });
    };
    const addBtn = h("button", { class: "btn primary", text: "+ Add", onclick: async () => { const l = Data.get("lists", st.list); if (!l) return; if (!canEditList(l)) return UI.toast("Only admins can add items to this list"); if (await addListItem(l)) view.refresh(); } });
    const tools = h("div", { class: "app-toolbar au-tools" }, h("button", { class: "btn au-back", text: "← Lists", onclick: () => nav.list(null) }), search, fBtn, h("span", { class: "grow" }), more, addBtn);
    const view = { cols: ["lists", "listitems"], tools, draw(box) {
      const l = Data.get("lists", st.list);
      if (!l) return box.replaceChildren(Apps.empty("🔍", "This list was not found.", h("button", { class: "btn", text: "Back to lists", onclick: () => nav.list(null) })));
      const fields = l.fields || [], edit = canEditList(l);
      addBtn.style.display = edit && !st.showDeleted ? "" : "none";
      const mine = Data.list("listitems").filter(x => x.list === l.id && !!x.deleted === !!st.showDeleted);
      let items = mine;
      Object.entries(st.lf).forEach(([k, v]) => {
        if (v === "" || v == null) return; const f = fields.find(x => x.key === k); if (!f) return;
        items = items.filter(x => f.type === "checkbox" ? (!!x.values?.[k]) === (v === "yes") : String(x.values?.[k] ?? "") === v);
      });
      if (st.q) items = items.filter(x => fields.some(f => low(plain(f, x.values?.[f.key])).includes(st.q)));
      const sf = st.sort && fields.find(f => f.key === st.sort.key);
      items = items.slice().sort((a, b) => sf ? st.sort.dir * cmpVals(sf, a, b) || (a.at || 0) - (b.at || 0) : (a.at || 0) - (b.at || 0));
      const sortBy = k => { st.sort = st.sort?.key === k ? (st.sort.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }; view.refresh(); };
      const ft = fields.find(f => f.type === "text");
      const inline = edit && !st.showDeleted ? h("tr", { class: "au-inline" }, h("td", { colspan: fields.length + 1 }, ft ? (() => {
        const i = h("input", { class: "au-inline-in", placeholder: `+ Add ${ft.label.toLowerCase()}… (Enter)` });
        i.onkeydown = async e => {
          if (e.key === "Escape") { i.value = ""; i.blur(); }
          if (e.key !== "Enter" || !i.value.trim()) return;
          const values = { [ft.key]: i.value.trim() }; i.value = "";
          if (fields.some(f => f.required && f.key !== ft.key)) { await addListItem(l, values); view.refresh(); return; }
          await Data.add("listitems", { list: l.id, values, deleted: false });
          view.refresh(); setTimeout(() => box.querySelector(".au-inline-in")?.focus(), 30);
        };
        return i;
      })() : h("button", { class: "au-inline-btn", text: "+ Add item", onclick: () => addListItem(l).then(() => view.refresh()) }))) : null;
      const table = h("div", { class: "au-tablewrap glass" }, h("table", { class: "au-table" },
        h("thead", null, h("tr", null, ...fields.map(f => h("th", { class: "au-sortable", onclick: () => sortBy(f.key) }, f.label, st.sort?.key === f.key ? h("span", { class: "au-arrow", text: st.sort.dir === 1 ? " ▲" : " ▼" }) : null)), h("th", { text: "Added" }))),
        h("tbody", null, ...items.map((it, i) => h("tr", { class: st.showDeleted ? "au-deleted" : "", style: { animationDelay: Math.min(i, 20) * 15 + "ms" }, onclick: async () => {
          if (st.showDeleted) { if (edit && await UI.confirm("Restore this item?", "Restore")) Data.update("listitems", it.id, { deleted: false }); return; }
          openListItem(l, it);
        } }, ...fields.map(f => h("td", null, show(f, it.values?.[f.key], true))), h("td", { class: "au-dim" }, h("span", { class: "au-person" }, Apps.avatar(Data.person(it.by), 18), h("span", { text: UI.timeAgo(it.at) }))))), inline)));
      box.replaceChildren(
        h("div", { class: "au-vh" }, h("span", { class: "au-vh-ic", text: l.icon || "🗂️" }), h("div", null, h("h2", { text: l.name + (st.showDeleted ? " · deleted items" : "") }),
          h("small", { text: [l.desc, !edit ? "🔒 Only admins can edit" : ""].filter(Boolean).join(" · ") || plural(mine.length, "item") }))),
        fields.length ? table : Apps.empty("🧱", "This list has no fields yet."),
        h("div", { class: "au-foot", text: items.length === mine.length ? plural(items.length, "item") : `${items.length} of ${plural(mine.length, "item")}` }));
    } };
    paintF();
    return view;
  }

  /* =====================================================================
     ANALYTICS
     ===================================================================== */
  function kpi(label, value, color, sub) {
    return h("div", { class: "kpi glass au-kpi", style: color ? { "--kc": cvar(color) } : null }, h("span", { text: label }), h("b", { text: value }), sub ? h("small", { text: sub }) : null);
  }
  function bars(rows) {
    const max = Math.max(1, ...rows.map(r => +r.value || 0));
    if (!rows.length) return h("div", { class: "au-dim", text: "No data yet" });
    return h("div", { class: "au-bars" }, ...rows.map((r, i) => h("div", { class: "au-bar-row" }, h("span", { class: "au-bar-l", text: r.label, title: r.label }),
      h("div", { class: "au-bar" }, h("span", { style: { width: Math.max(r.value ? 3 : 0, (+r.value || 0) / max * 100) + "%", background: cvar(r.color || "blue"), animationDelay: i * 50 + "ms" } })),
      h("b", { text: r.note ?? String(r.value) }))));
  }
  function columns(data) {
    const W = 560, H = 170, L = 8, n = data.length, max = Math.max(1, ...data.map(d => d.value)), bw = (W - L * 2) / n, base = H - 22;
    const parts = data.map((d, i) => {
      const bh = Math.round((base - 22) * d.value / max), x = L + i * bw + bw * .18, w = bw * .64, y = base - bh, cx = (x + w / 2).toFixed(1);
      return `<rect class="au-cbar" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${Math.max(bh, d.value ? 2 : 0)}" rx="4" style="animation-delay:${i * 30}ms"><title>${esc(d.label)}: ${d.value}</title></rect>`
        + (d.value ? `<text class="au-cv" x="${cx}" y="${y - 5}" text-anchor="middle">${d.value}</text>` : "")
        + (i % 2 === (n - 1) % 2 ? `<text class="au-cl" x="${cx}" y="${H - 5}" text-anchor="middle">${esc(d.short)}</text>` : "");
    }).join("");
    return h("div", { class: "au-chart", html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rule runs per day"><line class="au-axis" x1="${L}" y1="${base}" x2="${W - L}" y2="${base}"/>${parts}</svg>` });
  }
  function donut(segs, label) {
    const total = segs.reduce((s, x) => s + x.value, 0), R = 44, C = 2 * Math.PI * R; let off = 0;
    const arcs = segs.filter(s => s.value).map(s => {
      const len = C * s.value / total, el = `<circle class="au-arc" r="${R}" cx="60" cy="60" fill="none" stroke-width="16" style="stroke:${cvar(s.color)}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      off += len; return el;
    }).join("");
    return h("div", { class: "au-donut" }, h("div", { class: "au-donut-svg", html: `<svg viewBox="0 0 120 120"><circle class="au-donut-bg" r="${R}" cx="60" cy="60" fill="none" stroke-width="16"/>${arcs}<text class="au-dn" x="60" y="60" text-anchor="middle">${total}</text><text class="au-dl" x="60" y="76" text-anchor="middle">${esc(label)}</text></svg>` }),
      h("div", { class: "au-legend" }, ...segs.map(s => h("div", null, h("i", { style: { background: cvar(s.color) } }), h("span", { text: s.label }), h("b", { text: s.value })))));
  }
  function viewAnalytics() {
    return { cols: ["rules", "wfruns", "workflows", "processes", "procitems"], tools: null, draw(box) {
      const rules = Data.list("rules").filter(r => r.trigger), runs = Data.list("wfruns"), procs = Data.list("processes").sort(byName), items = Data.list("procitems").filter(i => !i.deleted);
      const totalRuns = rules.reduce((s, r) => s + (r.runs || 0), 0), logs = rules.flatMap(r => r.log || []);
      const days = Array.from({ length: 14 }, (_, i) => { const d = Apps.addDays(Apps.today(), i - 13); return { iso: d, label: Apps.fmtDate(d), short: String(+d.slice(8)), value: 0 }; });
      logs.forEach(x => { const d = days.find(y => y.iso === Apps.iso(new Date(x.at))); if (d) d.value++; });
      const recent = days.reduce((s, d) => s + d.value, 0), failed = logs.filter(x => !x.ok).length;
      const st = s => runs.filter(r => r.status === s).length;
      const times = []; runs.forEach(r => { let prev = r.at || 0; (r.decisions || []).slice().sort((a, b) => a.at - b.at).forEach(d => { if (d.at > prev) times.push(d.at - prev); prev = d.at; }); });
      const fin = runs.filter(r => r.finishedAt && r.status !== "cancelled").map(r => r.finishedAt - r.at).filter(x => x > 0);
      const byWf = {}; runs.forEach(r => { const k = r.name || "Approval"; (byWf[k] ||= { n: 0, ok: 0 }).n++; if (r.status === "approved") byWf[k].ok++; });
      const procDone = items.filter(it => { const p = procs.find(x => x.id === it.process); return p && it.stage === finalOf(p); }).length;
      const out = [
        h("div", { class: "au-kpis" },
          kpi("Rules on", `${rules.filter(r => r.enabled !== false).length} / ${rules.length}`, "blue"),
          kpi("Rule runs", totalRuns, "purple", `${recent} in the last 14 days${failed ? " · " + failed + " failed" : ""}`),
          kpi("Open approvals", st("running"), "orange", `${pending().length} waiting for you`),
          kpi("Approved", st("approved"), "green", `${st("declined")} declined`),
          kpi("Average time to decide", times.length ? dur(mean(times)) : "—", "pink", fin.length ? "whole request: " + dur(mean(fin)) : ""),
          kpi("Process items", items.length, "yellow", `${procDone} done`)),
        h("div", { class: "reports au-reports" },
          h("div", { class: "report glass" }, h("h3", { text: "Rule runs, last 14 days" }), recent ? columns(days) : h("div", { class: "au-dim au-pad", text: "No rule runs recorded in the last 14 days." })),
          h("div", { class: "report glass" }, h("h3", { text: "Runs per rule" }), bars(rules.slice().sort((a, b) => (b.runs || 0) - (a.runs || 0)).slice(0, 8).map((r, i) => ({ label: r.name || "Rule", value: r.runs || 0, color: COLORS[(i + 1) % COLORS.length] })))),
          h("div", { class: "report glass" }, h("h3", { text: "Approvals" }), donut([{ label: "Open", value: st("running"), color: "orange" }, { label: "Approved", value: st("approved"), color: "green" }, { label: "Declined", value: st("declined"), color: "red" }, { label: "Withdrawn", value: st("cancelled"), color: "gray" }], "requests")),
          h("div", { class: "report glass" }, h("h3", { text: "Requests by process" }), bars(Object.entries(byWf).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, v], i) => ({ label: k, value: v.n, color: COLORS[(i + 3) % COLORS.length], note: `${v.n} · ${Math.round(v.ok / v.n * 100)}% ok` })))),
          ...procs.map(p => {
            const its = items.filter(i => i.process === p.id), now = Date.now(), tm = its.map(it => stageTimes(it, now)), f = finalOf(p);
            return h("div", { class: "report glass" }, h("h3", { text: (p.icon || "🧩") + " " + p.name }),
              bars((p.stages || []).map(s => { const v = tm.map(t => t[s.id]).filter(x => x > 0); return { label: s.name, value: its.filter(x => stageIn(p, x.stage).id === s.id).length, color: s.color, note: its.filter(x => stageIn(p, x.stage).id === s.id).length + (s.id !== f && v.length ? " · ~" + dur(mean(v)) : "") }; })),
              h("small", { class: "au-dim", text: "Items now in each stage · average time spent there" }));
          })),
      ];
      box.replaceChildren(...out);
    } };
  }

  /* =====================================================================
     APP SHELL
     ===================================================================== */
  const TABS = [["rules", "Rules"], ["approvals", "Approvals"], ["rpa", "RPA"], ["lists", "Lists"], ["analytics", "Analytics"]];
  // Settings → Tools → Automation: rules, approvals, rpa, lists can be switched off (default on)
  const toolOn = f => !window.Prefs || Prefs.tool("automation", f);
  const tabOn = k => k === "analytics" || toolOn(k);
  const OFF_TXT = { rules: "Automation rules are", approvals: "Approvals are", rpa: "RPA processes are", lists: "Lists are" };
  const badgeFns = new Set();
  function updateBadge() { const n = pending().length; Apps.badge("automation", n); badgeFns.forEach(f => { try { f(n); } catch {} }); }
  setTimeout(() => Data.on("wfruns", updateBadge), 1500);
  Apps.onWorkspace.add(() => setTimeout(updateBadge, 800));

  function render(root, arg) {
    root.classList.add("au-app");
    if (!canView()) { root.append(Apps.header("Automation", "⚡", "Rules, approvals, processes and lists"), Apps.empty("🔒", "You don't have access to Automation. Ask an admin.")); return () => {}; }
    const st = { tab: LS.get("tab", "rules"), list: null, proc: null, item: null, procView: LS.get("procView", "board"), ap: LS.get("ap", "mine"), apStatus: "all", q: "", sort: null, lf: {}, showDeleted: false };
    let openRunId = null;
    if (arg) {
      if (arg.startsWith("run:")) { st.tab = "approvals"; openRunId = arg.slice(4); }
      else if (arg.startsWith("list:")) { st.tab = "lists"; st.list = arg.slice(5); }
      else if (arg.startsWith("proc:")) { const [, p, it] = arg.split(":"); st.tab = "rpa"; st.proc = p || null; st.item = it || null; }
      else if (TABS.some(t => t[0] === arg)) st.tab = arg;
    }
    if (!TABS.some(t => t[0] === st.tab)) st.tab = "rules";
    const tabsEl = Apps.tabs(TABS, st.tab, k => { st.tab = k; st.list = st.proc = null; st.q = ""; LS.set("tab", k); setHash(k); mount(); });
    const apBtn = tabsEl.children[1];
    const paintTab = n => { apBtn.replaceChildren("Approvals", n ? h("span", { class: "au-count", text: n }) : null); };
    badgeFns.add(paintTab); paintTab(pending().length);
    const body = h("div", { class: "au-body" });
    const startBtn = h("button", { class: "btn", text: "📝 Start a process", onclick: () => startDialog() });
    root.append(Apps.header("Automation", "⚡", "Rules, approvals, processes and lists", startBtn), tabsEl, body);
    let toolSig = "";
    const paintTools = () => { TABS.forEach(([k], i) => { if (tabsEl.children[i]) tabsEl.children[i].hidden = !tabOn(k) && k !== st.tab; }); startBtn.hidden = !toolOn("approvals"); };

    let offs = [], raf = 0;
    const nav = {
      list(id) { st.list = id || null; st.q = ""; st.lf = {}; st.sort = null; st.showDeleted = false; setHash(id ? "list:" + id : "lists"); mount(); },
      proc(id) { st.proc = id || null; st.q = ""; setHash(id ? "proc:" + id : "rpa"); mount(); },
    };
    const VIEWS = { rules: viewRules, approvals: viewApprovals, rpa: viewRPA, lists: viewLists, analytics: viewAnalytics };
    function mount() {
      offs.forEach(f => f()); offs = []; cancelAnimationFrame(raf);
      paintTools(); toolSig = TABS.map(([k]) => tabOn(k)).join();
      const v = tabOn(st.tab) ? VIEWS[st.tab](st, nav) : { cols: [], draw: box => box.replaceChildren(Apps.empty("🔌", OFF_TXT[st.tab] + " switched off in Settings → Tools.")) }, content = h("div", { class: "au-content" });
      const run = () => { try { v.draw(content); } catch (e) { console.error("automation view", e); } };
      v.refresh = run;
      body.replaceChildren(h("div", { class: "au-view au-in" }, v.tools || null, content));
      const redraw = UI.liveDraw(content, run);
      run();
      const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };
      v.cols.forEach(c => offs.push(Data.on(c, sched)));
    }
    mount();
    if (openRunId && toolOn("approvals")) setTimeout(() => openRun(openRunId), 80);
    // settings changed: remount only when a sub-feature was switched on or off
    const offPrefs = window.Prefs ? Prefs.on(() => { if (TABS.map(([k]) => tabOn(k)).join() !== toolSig) mount(); }) : () => {};
    return () => { offPrefs(); offs.forEach(f => f()); cancelAnimationFrame(raf); badgeFns.delete(paintTab); [...panelOffs].forEach(f => f()); };
  }

  Apps.Workflows = {
    start(workflowId, values) { if (!toolOn("approvals")) return UI.toast("Approvals are switched off in Settings → Tools."); return values ? startRun(workflowId, values) : startDialog(workflowId); },
    pending, open: openRun,
  };
  Apps.register("automation", { title: "Automation", icon: "⚡", render });
})();
