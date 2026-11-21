/* Booking (js/apps/booking.js): Bitrix24-style booking of resources (people, rooms, equipment) and services.
   Schedule (day: one column per resource; week: one resource over seven days) with counters, drag to move or
   resize, conflict check, a booking editor linked to CRM contacts and deals, resources (with bundles),
   services, clients, working hours and 15-minute reminders for the linked teammate.
   Everything lives in the `bookings` collection, told apart by `kind`: "resource" | "service" | "booking".
   Extra fields kept here: resource.order (sort), service.bundle (needs all its resources at once),
   booking.group (bookings of one bundle share it). Settings live in settings/booking. */
(function () {
  const { h, esc } = UI;
  const HOUR = 64; // px per hour in the schedule
  const PAL = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_LONG = DAYS.map((_, i) => new Date(2024, 0, i + 1).toLocaleDateString(undefined, { weekday: "long" }));
  // workspace settings (js/prefs.js): business hours (start/end, weekend, first day of the week), region, default phone country code
  const wsHours = () => (window.Prefs ? Prefs.get("hours") : null) || { start: "09:00", end: "18:00", weekend: [0, 6], weekStart: 1 };
  const okHM = (v, d) => /^\d\d?:\d\d$/.test(v || "") ? v : d;
  const openT = () => okHM(wsHours().start, "09:00"), closeT = () => okHM(wsHours().end, "18:00");
  const WS = () => { const v = +(wsHours().weekStart ?? 1); return [0, 1, 6].includes(v) ? v : 1; };
  // Monday-first names, shown starting on the workspace's first day of the week (Jan 7 2024 is a Sunday)
  const dayMini = () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + (WS() + i) % 7).toLocaleDateString(undefined, { weekday: "narrow" }));
  // default opening hours = the workspace's business hours on working days (used until Booking settings have their own hours)
  const defHours = () => { const we = Array.isArray(wsHours().weekend) ? wsHours().weekend : [0, 6]; return Object.fromEntries(DAYS.map((d, i) => [d, we.includes((i + 1) % 7) ? null : [openT(), closeT()]])); };
  const time24 = () => !!(window.Prefs && Prefs.get("region.time24"));
  const phonePrefix = () => { const c = String((window.Prefs && Prefs.get("people.phoneCountry")) || "").trim().replace(/[^\d+]/g, ""); return /^\+?\d{1,4}$/.test(c) ? "+" + c.replace("+", "") + " " : ""; };
  const STATUS = {
    unconfirmed: { label: "Not confirmed", ic: "⏳" },
    confirmed: { label: "Confirmed", ic: "👍" },
    late: { label: "Late", ic: "⏰" },
    noshow: { label: "No-show", ic: "🚫" },
    done: { label: "Done", ic: "🏁" },
    cancelled: { label: "Cancelled", ic: "✕" },
  };
  const TYPES = { person: ["👤", "Person"], room: ["🚪", "Room"], equipment: ["🧰", "Equipment"] };
  const CURRENCIES = ["USD", "EUR", "GBP", "INR", "RUB", "UAH", "KZT", "PLN", "TRY", "AED", "CAD", "AUD", "CHF", "BRL", "JPY", "CNY"];
  const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480];
  const mobile = () => innerWidth <= 760;

  /* ---------- dates & times: "YYYY-MM-DD", "HH:MM" (whole-day maths in UTC so DST never shifts a day) ---------- */
  const dn = s => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const nd = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const add = (s, n) => nd(dn(s) + n);
  const okDate = s => /^\d{4}-\d\d-\d\d$/.test(s || "");
  const toMin = t => /^\d\d?:\d\d$/.test(t || "") ? +t.split(":")[0] * 60 + +t.split(":")[1] : null;
  const toHM = m => { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const dObj = s => new Date(s + "T00:00");
  const fmtD = (s, o = { month: "short", day: "numeric" }) => okDate(s) ? dObj(s).toLocaleDateString(undefined, o) : "";
  const fmtT = t => {
    const m = toMin(t); if (m == null) return "";
    try { const r = Apps.fmtTime?.(toHM(m)); if (r && !/invalid|nan/i.test(r)) return r; } catch {}
    return new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString([], time24() ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "numeric", minute: "2-digit" });
  };
  const fmtM = m => fmtT(toHM(m));
  const hourLabel = hr => time24() ? String(hr).padStart(2, "0") + ":00" : new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: "numeric" });
  const wd = s => (dObj(s).getDay() + 6) % 7; // Monday = 0 (index into DAYS)
  const weekStart = s => add(s, -((dObj(s).getDay() - WS() + 7) % 7)); // first day of the week from Settings → Business hours
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const durTxt = m => m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min";
  const addMonth = (m, n) => { const d = dObj(m.slice(0, 8) + "01"); d.setMonth(d.getMonth() + n); return Apps.iso(d).slice(0, 8) + "01"; };

  /* ---------- settings ---------- */
  function S() {
    const s = Data.get("settings", "booking") || {};
    return { hours: { ...defHours(), ...(s.hours || {}) }, slot: [15, 30, 60].includes(+s.slot) ? +s.slot : 30, currency: s.currency || Apps.currency() };
  }
  // working hours of a date as minutes [open, close], or null when closed
  function hoursOf(date, st = S()) {
    const x = st.hours[DAYS[wd(date)]];
    if (!Array.isArray(x)) return null;
    const a = toMin(x[0]), b = toMin(x[1]);
    return a == null || b == null || b <= a ? null : [a, b];
  }
  function money(n, cur) {
    const v = +n || 0;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || S().currency, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v); } catch { return Apps.money(v); }
  }

  /* ---------- model (old docs may lack fields: always default) ---------- */
  const me = () => Data.me().key;
  const all = () => Data.list("bookings");
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.name || "").localeCompare(String(b.name || ""));
  const resources = activeOnly => all().filter(x => x.kind === "resource" && (!activeOnly || x.active !== false)).sort(byOrder);
  const services = () => all().filter(x => x.kind === "service").sort(byOrder);
  const bookings = () => all().filter(x => x.kind === "booking" && !x.deleted && okDate(x.date));
  const res = id => { const r = id && Data.get("bookings", id); return r && r.kind === "resource" ? r : null; };
  const svc = id => { const s = id && Data.get("bookings", id); return s && s.kind === "service" ? s : null; };
  const bColor = b => svc(b.service)?.color || res(b.resource)?.color || PAL[0];
  const groupOf = b => b.group ? bookings().filter(x => x.group === b.group) : [b];
  const startMin = b => toMin(b.start) ?? 0;
  const endMin = b => { const s = startMin(b), f = toMin(b.finish); return f != null && f > s ? f : s + 30; };
  const startAt = b => new Date(b.date + "T" + toHM(startMin(b))).getTime();
  const clientName = b => (b.client && b.client.name) || "No client";
  // late is shown (never written) once the start passed by 10 minutes and nobody marked it otherwise
  function status(b) {
    const s = STATUS[b.status] ? b.status : "unconfirmed";
    if ((s === "unconfirmed" || s === "confirmed") && Date.now() > startAt(b) + 10 * 60000) return "late";
    return s;
  }
  // a bundle is several bookings sharing a group: count it once
  const unique = list => { const seen = new Set(); return list.filter(b => !b.group || (!seen.has(b.group) && seen.add(b.group))); };
  function clientKey(c) {
    c = c || {};
    const ph = String(c.phone || "").replace(/\D/g, "");
    return ph.length >= 5 ? "p:" + ph : c.email ? "e:" + String(c.email).toLowerCase().trim() : c.contact ? "c:" + c.contact : c.name ? "n:" + String(c.name).toLowerCase().trim() : "";
  }
  function conflicts(resource, date, s, f, ignore = []) {
    return bookings().filter(b => b.resource === resource && b.date === date && b.status !== "cancelled" && !ignore.includes(b.id) && startMin(b) < f && s < endMin(b));
  }
  const clashText = list => list.slice(0, 3).map(x => `${res(x.resource)?.name || "Resource"} · ${fmtT(x.start)}–${fmtT(x.finish)} (${clientName(x)})`).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
  const askOverlap = list => UI.confirm(`This overlaps ${list.length === 1 ? "a booking" : list.length + " bookings"}: ${clashText(list)}. Book anyway?`, "Book anyway");
  function lanes(list) {
    list.sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], end = -1;
    const flush = () => { const cols = []; cluster.forEach(x => { let i = cols.findIndex(c => c <= x.s); if (i < 0) { i = cols.length; cols.push(0); } cols[i] = x.e; x.lane = i; }); cluster.forEach(x => (x.lanes = cols.length)); cluster = []; };
    list.forEach(x => { if (cluster.length && x.s >= end) { flush(); end = -1; } cluster.push(x); end = Math.max(end, x.e); });
    flush();
  }
  const link = id => "#/app/booking/" + encodeURIComponent(id);
  function whenOf(b) { return fmtD(b.date, { weekday: "short", month: "short", day: "numeric" }) + " · " + fmtT(b.start) + " – " + fmtT(b.finish); }

  // tell the resource's teammate about a booking someone else made for them
  function tellPerson(b, verb = "booked") {
    const r = res(b.resource);
    if (!r || !r.person || r.person === me()) return;
    Data.notify(r.person, `🗓️ <b>${esc(Data.me().name)}</b> ${verb} <b>${esc(clientName(b))}</b> with you`, link(b.id), [svc(b.service)?.name, whenOf(b), r.name].filter(Boolean).join(" · "));
  }
  function setStatus(b, st) {
    groupOf(b).forEach(x => Data.update("bookings", x.id, { status: st }));
    UI.toast(STATUS[st].ic + " " + STATUS[st].label);
  }
  function setPaid(b, paid) {
    groupOf(b).forEach(x => Data.update("bookings", x.id, { paid }));
    UI.toast(paid ? "💰 Marked as paid" : "Marked as not paid");
  }
  async function removeBooking(b) {
    const g = groupOf(b);
    if (!await UI.confirm(g.length > 1 ? `Delete this bundle booking for ${clientName(b)}? All ${g.length} resources are freed.` : `Delete the booking for ${clientName(b)}?`)) return false;
    g.forEach(x => Data.remove("bookings", x.id));
    UI.toast("Booking deleted");
    return true;
  }
  function statusMenu(anchor, b, extra = true) {
    const st = status(b);
    UI.menu(anchor, [
      { section: "Status" },
      ...Object.entries(STATUS).map(([k, s]) => ({ label: s.label + (st === k ? "  ✓" : ""), iconHtml: s.ic, onClick: () => setStatus(b, k) })),
      { sep: true },
      { label: b.paid ? "Mark as not paid" : "Mark as paid", iconHtml: "💰", onClick: () => setPaid(b, !b.paid) },
      extra ? { label: "Edit booking", iconHtml: "✏️", onClick: () => editBooking(b) } : null,
      extra ? { label: "Delete", icon: "trash", danger: true, onClick: () => removeBooking(b) } : null,
    ], { align: "end" });
  }

  /* ---------- booking editor ---------- */
  function nextSlot(date, st = S()) {
    const hr = hoursOf(date, st);
    if (date === Apps.today()) {
      let m = Math.ceil((nowMin() + 1) / st.slot) * st.slot;
      if (hr && m < hr[0]) m = hr[0];
      return toHM(Math.min(m, 23 * 60));
    }
    return toHM(hr ? hr[0] : 10 * 60);
  }
  // CRM contacts and earlier clients matching a search
  function clientSuggestions(q) {
    const out = [], seen = new Set();
    const push = c => { const k = clientKey(c) || c.name; if (!c.name || seen.has(k)) return; seen.add(k); out.push(c); };
    Data.list("contacts").filter(c => !c.deleted && c.name && [c.name, c.phone, c.email].join(" ").toLowerCase().includes(q))
      .forEach(c => push({ name: c.name, phone: c.phone || "", email: c.email || "", contact: c.id }));
    bookings().sort((a, b) => (b.at || 0) - (a.at || 0)).map(b => b.client || {}).filter(c => c.name && [c.name, c.phone, c.email].join(" ").toLowerCase().includes(q))
      .forEach(c => push({ name: c.name, phone: c.phone || "", email: c.email || "", contact: c.contact || "" }));
    return out;
  }

  function editBooking(b, preset = {}) {
    if (b && b.kind !== "booking") return;
    if (!resources(true).length && !b) { UI.toast("Add a resource first"); return; }
    const st = S(), isNew = !b, g = b ? groupOf(b) : [];
    let svcId = b ? b.service || "" : preset.service || "";
    let client = { ...((b && b.client) || preset.client || {}) };
    let stat = b ? (STATUS[b.status] ? b.status : "unconfirmed") : "unconfirmed";
    let paid = !!(b && b.paid), saveContact = false, done = false;
    const sv0 = svc(svcId);
    const d0 = (b && b.date) || preset.date || Apps.today();
    const s0 = (b && b.start) || preset.start || nextSlot(d0, st);
    const inp = (type, value, extra = {}) => h("input", { class: "menu-input", type, value, ...extra });
    const date = inp("date", d0);
    const start = inp("time", s0, { step: 300 });
    const finish = inp("time", (b && b.finish) || toHM(toMin(s0) + (+sv0?.duration || 60)), { step: 300 });
    const price = inp("number", b ? (b.price ?? "") : (sv0?.price ?? ""), { min: 0, step: "any", placeholder: "0" });
    const durLbl = h("span", { class: "bk-ed-dur" });
    const note = h("div", { class: "bk-ed-note" });

    const svcSel = h("select", { class: "menu-input" }, h("option", { value: "" }, "No service"),
      ...services().map(s => h("option", { value: s.id, selected: s.id === svcId }, `${s.bundle ? "🔗 " : ""}${s.name || "Service"} · ${durTxt(+s.duration || 60)}${+s.price ? " · " + money(s.price, st.currency) : ""}`)));
    const resSel = h("select", { class: "menu-input" });
    const resBox = h("div", { class: "bk-ed-res" });
    const curRes = (b && b.resource) || preset.resource || "";
    const bundleList = () => {
      const sv = svc(svcId);
      if (sv && sv.bundle) { const l = (sv.resources || []).filter(id => res(id)); if (l.length) return l; }
      if (b && b.group && svcId === (b.service || "") && !sv) return g.map(x => x.resource);
      return null;
    };
    // auto: the service just changed, so move to a resource that offers it
    function paintRes(auto) {
      const bl = bundleList(), sv = svc(svcId);
      if (bl) {
        resBox.replaceChildren(h("div", { class: "bk-ed-bundle" }, h("small", { text: "🔗 Resource bundle: all of these are booked together" }),
          h("div", { class: "bk-chips" }, ...bl.map(id => { const r = res(id) || {}; return h("span", { class: "bk-rchip on static", style: { "--c": r.color || PAL[0] } }, h("i"), r.name || "Removed resource"); }))));
        return;
      }
      const keep = resSel.value || curRes;
      const list = resources(true); const extra = res(curRes); if (extra && !list.includes(extra)) list.push(extra);
      const offers = sv && (sv.resources || []).length ? sv.resources : null;
      resSel.replaceChildren(...list.map(r => h("option", { value: r.id }, (TYPES[r.type] || TYPES.person)[0] + " " + (r.name || "Resource") + (offers && !offers.includes(r.id) ? " (doesn't offer this)" : ""))));
      let val = list.some(r => r.id === keep) ? keep : list[0]?.id || "";
      if (auto && offers && !offers.includes(val)) { const alt = list.find(r => offers.includes(r.id)); if (alt) val = alt.id; }
      resSel.value = val;
      resBox.replaceChildren(resSel);
    }
    function check() {
      const s = toMin(start.value), f = toMin(finish.value), d = date.value, msgs = [];
      durLbl.textContent = s != null && f != null && f > s ? durTxt(f - s) : "";
      if (s != null && f != null && f <= s) msgs.push(["warn", "Finish must be after the start"]);
      else if (s != null && f != null && okDate(d)) {
        const list = bundleList() || [resSel.value];
        const cl = stat === "cancelled" ? [] : list.flatMap(r => conflicts(r, d, s, f, g.map(x => x.id)));
        if (cl.length) msgs.push(["warn", "⚠️ Overlaps " + clashText(cl)]);
        const hr = hoursOf(d, st);
        if (!hr) msgs.push(["info", "🌙 You're closed on " + fmtD(d, { weekday: "long" }) + "s"]);
        else if (s < hr[0] || f > hr[1]) msgs.push(["info", `🌙 Outside working hours (${fmtM(hr[0])} – ${fmtM(hr[1])})`]);
        if (!msgs.length) msgs.push(["ok", "✓ This time is free"]);
      }
      note.replaceChildren(...msgs.map(([k, t]) => h("div", { class: "bk-ed-msg " + k, text: t })));
    }
    let lastStart = toMin(start.value);
    svcSel.onchange = () => {
      svcId = svcSel.value; const sv = svc(svcId);
      if (sv) { const s = toMin(start.value); if (s != null) finish.value = toHM(s + (+sv.duration || 60)); price.value = sv.price ?? ""; }
      paintRes(true); check();
    };
    start.addEventListener("change", () => {
      const s = toMin(start.value), f = toMin(finish.value); if (s == null) return;
      const dur = f != null && lastStart != null && f > lastStart ? f - lastStart : (+svc(svcId)?.duration || 60);
      finish.value = toHM(s + dur); lastStart = s; check();
    });
    finish.addEventListener("change", check); date.addEventListener("change", check); resSel.addEventListener("change", check);

    /* client */
    const cName = inp("text", client.name || "", { placeholder: "Client name, phone or email to search", autocomplete: "off" });
    const cPhone = inp("tel", client.phone || phonePrefix(), { placeholder: "Phone" });
    const cEmail = inp("email", client.email || "", { placeholder: "Email" });
    const linkRow = h("div", { class: "bk-ed-link" });
    function paintLink() {
      const c = client.contact && Data.get("contacts", client.contact);
      linkRow.replaceChildren(c
        ? h("span", { class: "bk-crm-chip" }, "👤 CRM contact ", h("b", { text: c.name || "" }),
          window.Apps.CRM?.openRecord ? h("button", { type: "button", class: "bk-link-btn", text: "Open", onclick: () => Apps.CRM.openRecord("contacts", c.id) }) : null,
          h("button", { type: "button", class: "bk-x", text: "×", title: "Unlink contact", onclick: () => { client.contact = ""; paintLink(); } }))
        : h("label", { class: "bk-check" }, h("input", { type: "checkbox", checked: saveContact, onchange: e => (saveContact = e.target.checked) }), h("span", { text: "Save as CRM contact" })));
    }
    let pop = null;
    const closePop = () => { if (pop) { pop.close(); pop = null; } };
    const pick = c => { client = { ...c }; cName.value = c.name; cPhone.value = c.phone || ""; cEmail.value = c.email || ""; saveContact = false; closePop(); paintLink(); };
    cName.addEventListener("input", () => {
      const q = cName.value.trim().toLowerCase(); closePop();
      const linked = client.contact && Data.get("contacts", client.contact);
      if (linked && (linked.name || "").toLowerCase() !== q) { client.contact = ""; paintLink(); }
      if (!q) return;
      const found = clientSuggestions(q).slice(0, 6); if (!found.length) return;
      pop = UI.popover(cName, h("div", { class: "bk-sugg", style: { width: Math.max(240, cName.offsetWidth) + "px" } },
        h("div", { class: "menu-sec", text: "Pick a client" }),
        ...found.map(c => h("button", { type: "button", class: "mi compact", onmousedown: e => { e.preventDefault(); pick(c); } },
          h("span", { class: "mi-ic", text: c.contact ? "👤" : "🕘" }), h("span", { class: "mi-t", text: c.name }), h("span", { class: "mi-k", text: c.phone || c.email || (c.contact ? "CRM" : "") })))), { keep: true });
    });
    cName.addEventListener("blur", () => setTimeout(closePop, 160));

    /* status, payment, deal, note */
    const stBox = h("div", { class: "bk-st-pick" });
    const paintSt = () => stBox.replaceChildren(...Object.entries(STATUS).map(([k, s]) => h("button", { type: "button", class: "bk-st-btn st-" + k + (stat === k ? " on" : ""), onclick: () => { stat = k; paintSt(); check(); } }, s.ic + " " + s.label)));
    const paidSw = h("span", { class: "switch" + (paid ? " on" : "") });
    const paidBtn = h("button", { type: "button", class: "chip-btn bk-paid-btn", onclick: () => { paid = !paid; paidSw.classList.toggle("on", paid); } }, paidSw, "Paid");
    const deals = Data.list("deals").filter(d => !d.deleted).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 300);
    const dealSel = deals.length || (b && b.deal) ? h("select", { class: "menu-input" }, h("option", { value: "" }, "No deal"),
      ...deals.map(d => h("option", { value: d.id, selected: b && b.deal === d.id }, (d.title || "Deal") + (d.amount ? " · " + Apps.money(d.amount) : "")))) : null;
    const noteEl = h("textarea", { class: "menu-input bk-ed-ta", rows: 2, placeholder: "Note for the team (optional)" }); noteEl.value = (b && b.note) || "";

    const lab = (t, ...kids) => h("label", { class: "bk-f" }, h("span", { class: "bk-lab", text: t }), ...kids);
    const save = h("button", { class: "btn primary", text: isNew ? "Book" : "Save" });
    const body = h("div", { class: "bk-ed" },
      h("div", { class: "bk-ed-sec" },
        lab("Service", svcSel),
        h("div", { class: "bk-f" }, h("span", { class: "bk-lab", text: "Resource" }), resBox),
        h("div", { class: "bk-ed-when" }, lab("Date", date), lab("Start", start), lab("Finish", finish), durLbl),
        note),
      h("div", { class: "bk-ed-sec" },
        h("div", { class: "bk-ed-h", text: "Client" }),
        cName, h("div", { class: "bk-ed-2" }, cPhone, cEmail), linkRow),
      h("div", { class: "bk-ed-sec" },
        h("div", { class: "bk-ed-h", text: "Status and payment" }), stBox,
        h("div", { class: "bk-ed-pay" }, lab(`Price (${st.currency})`, price), paidBtn)),
      dealSel ? lab("Deal", dealSel) : null,
      lab("Note", noteEl),
      h("div", { class: "bk-ed-foot" },
        !isNew ? h("button", { class: "btn danger", text: "Delete", onclick: async () => { if (await removeBooking(b)) { done = true; m.close(); } } }) : null,
        h("span", { class: "grow" }),
        h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), save));
    const m = UI.modal(isNew ? "New booking" : "Booking", body, { className: "bk-ed-modal" });
    m.el.style.width = "600px";
    paintRes(); paintLink(); paintSt(); check();
    if (isNew) setTimeout(() => (svcSel.options.length > 1 ? svcSel : cName).focus(), 60);

    save.onclick = async () => {
      const d = date.value, s = toMin(start.value); let f = toMin(finish.value);
      if (!okDate(d) || s == null) return UI.toast("Pick a date and a start time");
      if (f == null || f <= s) f = Math.min(1439, s + (+svc(svcId)?.duration || 60));
      const list = bundleList() || [resSel.value].filter(Boolean);
      if (!list.length) return UI.toast("Choose a resource first");
      const ids = g.map(x => x.id);
      if (stat !== "cancelled") { const cl = list.flatMap(r => conflicts(r, d, s, f, ids)); if (cl.length && !await askOverlap(cl)) return; }
      client = { ...client, name: cName.value.trim(), phone: cPhone.value.trim() === phonePrefix().trim() ? "" : cPhone.value.trim(), email: cEmail.value.trim() };
      if (saveContact && !client.contact && client.name) {
        client.contact = Data.uid();
        Data.add("contacts", { name: client.name, phone: client.phone, email: client.email, owner: me(), activities: [], source: "Booking" }, client.contact);
        UI.toast("👤 Saved to CRM contacts");
      }
      const cl = { name: client.name, phone: client.phone, email: client.email }; if (client.contact) cl.contact = client.contact;
      const base = { kind: "booking", service: svcId || "", date: d, start: toHM(s), finish: toHM(f), client: cl, status: stat,
        price: price.value === "" ? 0 : Math.max(0, +price.value || 0), paid, note: noteEl.value.trim(), deal: dealSel ? dealSel.value : (b && b.deal) || "" };
      const group = list.length > 1 ? (b && b.group) || Data.uid() : null;
      // match existing bookings of the group to the wanted resources, add or remove the rest
      const pool = [...g], plan = list.map(r => { const i = pool.findIndex(x => x.resource === r); return [i >= 0 ? pool.splice(i, 1)[0] : null, r]; });
      plan.forEach(p => { if (!p[0] && pool.length) p[0] = pool.shift(); });
      pool.forEach(x => Data.remove("bookings", x.id));
      for (const [doc, r] of plan) {
        const rec = { ...base, resource: r, group };
        if (doc) { Data.update("bookings", doc.id, rec); if (doc.resource !== r) tellPerson({ ...doc, ...rec }); }
        else { const id = Data.uid(); Data.add("bookings", rec, id); tellPerson({ id, ...rec }); }
      }
      done = true; m.close();
      UI.toast(isNew ? `🗓️ Booked ${client.name || ""} for ${fmtD(d, { weekday: "short", month: "short", day: "numeric" })}, ${fmtT(toHM(s))}` : "Booking saved");
    };
    return m;
  }

  /* ---------- resources ---------- */
  async function editResource(r) {
    const v = await Apps.form(r ? "Edit resource" : "Add a resource", [
      { key: "name", label: "Name", required: true, placeholder: "e.g. Anna, Room 2, Massage chair" },
      { key: "type", label: "Type", type: "select", options: Object.entries(TYPES).map(([k, [ic, l]]) => [k, ic + " " + l]), half: true },
      { key: "person", label: "Linked teammate (for people)", type: "person", half: true },
      { key: "color", label: "Color", type: "color" },
      { key: "active", label: "Active: shown in the schedule", type: "checkbox" },
    ], r ? { ...r, type: r.type || "person", active: r.active !== false } : { type: "person", active: true, color: PAL[resources().length % PAL.length] },
    { ok: r ? "Save" : "Add resource", onDelete: r ? () => deleteResource(r) : null });
    if (!v) return null;
    const rec = { kind: "resource", name: String(v.name).trim(), type: v.type || "person", person: v.type === "person" ? v.person || "" : "", color: v.color || PAL[0], active: !!v.active };
    if (r) { Data.update("bookings", r.id, rec); UI.toast("Resource saved"); return r.id; }
    const max = resources().reduce((a, x) => Math.max(a, x.order ?? -1), -1), id = Data.uid();
    Data.add("bookings", { ...rec, order: max + 1 }, id);
    UI.toast("✨ Resource added");
    return id;
  }
  function deleteResource(r) {
    Data.remove("bookings", r.id);
    services().filter(s => (s.resources || []).includes(r.id)).forEach(s => Data.update("bookings", s.id, { resources: s.resources.filter(x => x !== r.id) }));
    UI.toast("Resource deleted");
  }

  /* ---------- services ---------- */
  function editService(sv, preset = {}) {
    if (!sv && preset.bundle && resources().length < 2) { UI.toast("A bundle needs at least two resources: add another resource first"); return; }
    const st = S();
    const v = sv ? { ...sv, resources: [...(sv.resources || [])] } : { name: "", duration: 60, price: "", color: PAL[(services().length + 3) % PAL.length], resources: [], bundle: !!preset.bundle, product: "" };
    let done = false;
    const name = h("input", { class: "menu-input", placeholder: v.bundle ? "e.g. Couples massage" : "e.g. Haircut", value: v.name || "" });
    const durs = DURATIONS.includes(+v.duration) ? DURATIONS : [...DURATIONS, +v.duration || 60].sort((a, b) => a - b);
    const dur = h("select", { class: "menu-input" }, ...durs.map(m => h("option", { value: m, selected: m === (+v.duration || 60) }, durTxt(m))));
    const price = h("input", { class: "menu-input", type: "number", min: 0, step: "any", placeholder: "0", value: v.price ?? "" });
    const colors = h("div", { class: "accents" }, ...PAL.map(c => h("button", { type: "button", class: v.color === c ? "on" : "", style: { background: c, color: c }, onclick: e => { v.color = c; colors.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } })));
    const resWrap = h("div", { class: "bk-chips" });
    const resLab = h("span", { class: "bk-lab" });
    const paintRes = () => {
      resLab.textContent = v.bundle ? "Resources booked together" : "Who can provide it (none = anyone)";
      const list = resources();
      resWrap.replaceChildren(...(list.length ? list.map(r => h("button", { type: "button", class: "bk-rchip" + (v.resources.includes(r.id) ? " on" : ""), style: { "--c": r.color || PAL[0] },
        onclick: () => { v.resources = v.resources.includes(r.id) ? v.resources.filter(x => x !== r.id) : [...v.resources, r.id]; paintRes(); } }, h("i"), r.name || "Resource")) : [h("small", { class: "bk-muted", text: "No resources yet" })]));
    };
    const bSw = h("span", { class: "switch" + (v.bundle ? " on" : "") });
    const bundleBtn = h("button", { type: "button", class: "chip-btn", onclick: () => { v.bundle = !v.bundle; bSw.classList.toggle("on", v.bundle); paintRes(); } }, bSw, "🔗 Resource bundle: needs all chosen resources at once");
    const prodRow = h("div", { class: "bk-prod" });
    const paintProd = () => {
      const p = v.product && Data.get("products", v.product);
      if (!window.Apps.Sales?.productPicker) { prodRow.replaceChildren(p ? h("span", { class: "bk-crm-chip", text: "📦 " + (p.name || "Product") }) : ""); return; }
      prodRow.replaceChildren(p
        ? h("span", { class: "bk-crm-chip" }, "📦 ", h("b", { text: p.name || "Product" }), h("button", { type: "button", class: "bk-x", text: "×", title: "Unlink product", onclick: () => { v.product = ""; paintProd(); } }))
        : h("button", { type: "button", class: "btn", text: "📦 Link product", onclick: e => Apps.Sales.productPicker(e.currentTarget, pr => {
          if (!pr) return; v.product = pr.id;
          if (!name.value.trim()) name.value = pr.name || "";
          if (price.value === "" && pr.price != null) price.value = pr.price;
          paintProd();
        }) }));
    };
    const lab = (t, ...kids) => h("label", { class: "bk-f" }, h("span", { class: "bk-lab", text: t }), ...kids);
    const saveBtn = h("button", { class: "btn primary", text: sv ? "Save" : v.bundle ? "Make bundle" : "Add service" });
    const body = h("div", { class: "bk-ed" },
      lab("Name", name),
      h("div", { class: "bk-ed-2" }, lab("Duration", dur), lab(`Price (${st.currency})`, price)),
      h("div", { class: "bk-f" }, h("span", { class: "bk-lab", text: "Color" }), colors),
      h("div", { class: "bk-f" }, resLab, resWrap),
      bundleBtn,
      prodRow,
      h("div", { class: "bk-ed-foot" },
        sv ? h("button", { class: "btn danger", text: "Delete", onclick: async () => { if (await UI.confirm(`Delete the service “${sv.name || "Service"}”? Existing bookings keep their time and price.`)) { Data.remove("bookings", sv.id); done = true; m.close(); UI.toast("Service deleted"); } } }) : null,
        h("span", { class: "grow" }), h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), saveBtn));
    const m = UI.modal(sv ? "Edit service" : v.bundle ? "Make resource bundle" : "Add a service", body, { className: "bk-ed-modal" });
    m.el.style.width = "540px";
    paintRes(); paintProd();
    setTimeout(() => name.focus(), 60);
    saveBtn.onclick = async () => {
      if (!name.value.trim()) return UI.toast("Name is required");
      const live = v.resources.filter(id => res(id));
      if (v.bundle && live.length < 2) return UI.toast("A bundle needs at least two resources");
      const rec = { kind: "service", name: name.value.trim(), duration: +dur.value || 60, price: price.value === "" ? 0 : Math.max(0, +price.value || 0), color: v.color || PAL[0], resources: live, bundle: !!v.bundle, product: v.product || "" };
      if (sv) Data.update("bookings", sv.id, rec); else Data.add("bookings", rec);
      done = true; m.close(); UI.toast(sv ? "Service saved" : v.bundle ? "🔗 Bundle created" : "✨ Service added");
    };
    return m;
  }

  /* ---------- sample setup ---------- */
  function sampleSetup() {
    const base = resources().reduce((a, x) => Math.max(a, x.order ?? -1), -1) + 1;
    const first = (Data.me().name || "You").split(" ")[0];
    const r1 = Data.uid(), r2 = Data.uid();
    Data.add("bookings", { kind: "resource", name: first, type: "person", person: me(), color: PAL[0], active: true, order: base }, r1);
    Data.add("bookings", { kind: "resource", name: "Treatment room", type: "room", person: "", color: PAL[2], active: true, order: base + 1 }, r2);
    Data.add("bookings", { kind: "service", name: "Consultation", duration: 30, price: 25, color: PAL[1], resources: [r1], bundle: false, product: "" });
    Data.add("bookings", { kind: "service", name: "Haircut", duration: 60, price: 45, color: PAL[6], resources: [r1], bundle: false, product: "" });
    Data.add("bookings", { kind: "service", name: "Spa ritual", duration: 90, price: 120, color: PAL[3], resources: [r1, r2], bundle: true, product: "" });
    UI.toast("✨ Sample setup added: click a free slot to book");
  }

  /* ---------- clients ---------- */
  function clientsData() {
    const map = new Map(), t = Apps.today();
    bookings().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).forEach(b => {
      const k = clientKey(b.client); if (!k) return;
      const c = b.client || {};
      const e = map.get(k) || { key: k, name: "", phone: "", email: "", contact: "", list: [] };
      e.name = c.name || e.name; e.phone = c.phone || e.phone; e.email = c.email || e.email; e.contact = c.contact || e.contact;
      e.list.push(b); map.set(k, e);
    });
    return [...map.values()].map(e => {
      const u = unique(e.list), visits = u.filter(b => b.status !== "cancelled" && b.status !== "noshow" && b.date <= t);
      return { ...e, u, visits: visits.length, last: visits.length ? visits[visits.length - 1].date : "", next: u.find(b => b.date >= t && b.status !== "cancelled" && b.status !== "noshow" && b.status !== "done")?.date || "",
        spent: u.filter(b => b.status !== "cancelled" && (b.paid || b.status === "done")).reduce((a, b) => a + (+b.price || 0), 0), noshows: u.filter(b => b.status === "noshow").length };
    });
  }
  function clientPanel(c) {
    const list = h("div", { class: "bk-hist" });
    const paint = () => {
      const fresh = clientsData().find(x => x.key === c.key) || c;
      list.replaceChildren(...[...fresh.u].reverse().map(b => {
        const stt = status(b), sv = svc(b.service), r = res(b.resource);
        return h("button", { class: "bk-hist-row", style: { "--c": bColor(b) }, onclick: () => editBooking(b) },
          h("span", { class: "bk-hist-d" }, h("b", { text: fmtD(b.date, { day: "numeric", month: "short" }) }), h("small", { text: b.date.slice(0, 4) })),
          h("span", { class: "bk-hist-m" }, h("b", { text: sv?.name || "Booking" }), h("small", { text: [fmtT(b.start) + " – " + fmtT(b.finish), b.group ? "🔗 " + groupOf(b).map(x => res(x.resource)?.name).filter(Boolean).join(" + ") : r?.name].filter(Boolean).join(" · ") })),
          h("span", { class: "bk-hist-r" }, h("span", { class: "bk-badge st-" + stt, text: STATUS[stt].label }), h("small", { text: (+b.price ? money(b.price) : "") + (b.paid ? " ✓" : "") })));
      }));
    };
    paint();
    const off = Data.on("bookings", paint);
    const kpi = (l, v, cls = "") => h("div", { class: "bk-kpi " + cls }, h("b", { text: v }), h("span", { text: l }));
    const p = Apps.panel(c.name || "Client", h("div", { class: "bk-client" },
      h("div", { class: "bk-client-head" }, h("span", { class: "bk-client-av", text: (c.name || "?").trim()[0]?.toUpperCase() || "?" }),
        h("div", null, h("h2", { text: c.name || "Client" }),
          h("div", { class: "bk-client-lines" }, c.phone ? h("a", { href: "tel:" + c.phone.replace(/[^\d+]/g, ""), text: "📞 " + c.phone }) : null, c.email ? h("a", { href: "mailto:" + c.email, text: "✉️ " + c.email }) : null))),
      h("div", { class: "bk-kpis" }, kpi("Visits", String(c.visits)), kpi("Last visit", c.last ? fmtD(c.last) : "—"), kpi("Total spent", money(c.spent)), kpi("No-shows", String(c.noshows), c.noshows ? "warn" : "")),
      h("div", { class: "bk-client-acts" },
        h("button", { class: "btn primary", text: "+ New booking", onclick: () => editBooking(null, { client: { name: c.name, phone: c.phone, email: c.email, contact: c.contact } }) }),
        c.contact && Data.get("contacts", c.contact) && window.Apps.CRM?.openRecord ? h("button", { class: "btn", text: "👤 Open in CRM", onclick: () => Apps.CRM.openRecord("contacts", c.contact) }) : null),
      h("div", { class: "td-sec", text: "Bookings" }), list));
    p.onClose = off;
  }

  /* ---------- the app ---------- */
  function render(root, arg) {
    const LS = (k, d) => { try { return localStorage.getItem("lumen-booking-" + k) || d; } catch { return d; } };
    const SET = (k, v) => { try { localStorage.setItem("lumen-booking-" + k, v); } catch {} };
    let tab = LS("tab", "schedule"); if (!["schedule", "clients", "resources", "services", "settings"].includes(tab)) tab = "schedule";
    let view = LS("view", "day") === "week" ? "week" : "day";
    let cur = Apps.today(), selRes = LS("res", ""), filter = "", showCancelled = LS("cancelled", "") === "1", q = "";
    let dragging = false, pending = false, justDragged = 0, anim = true, ready = false, scrollKey = "", wasMobile = mobile();
    let gridFrom = 8 * 60, gridTo = 20 * 60, colDefs = [], colEls = [], slot = 30;
    const y = m => (m - gridFrom) / 60 * HOUR;

    const body = h("div", { class: "bk-body" });
    root.append(
      Apps.header("Booking", "🗓️", "Resources, services and client bookings",
        h("button", { class: "btn primary", text: "+ Booking", onclick: () => editBooking(null, { date: cur, resource: view === "week" || mobile() ? selRes : undefined }) })),
      Apps.tabs([["schedule", "Schedule"], ["clients", "Clients"], ["resources", "Resources"], ["services", "Services"], ["settings", "Settings"]], tab, k => { tab = k; SET("tab", k); anim = true; draw(); }),
      body);

    /* ----- schedule ----- */
    function schedule() {
      const rsAll = resources(), rs = resources(true);
      if (!rsAll.length) return setupCard(true);
      if (!rs.length) return Apps.empty("😴", "All resources are switched off.", h("button", { class: "btn primary", text: "Open resources", onclick: () => switchTab("resources") }));
      if (!rs.some(r => r.id === selRes)) selRes = rs[0].id;
      const st = S(); slot = st.slot;
      const wrap = h("div", { class: "bk-sched" });
      wrap.append(toolbar(), counters());
      if (!services().length || !bookings().length) wrap.append(setupCard(false));
      const oneRes = view === "week" || mobile();
      if (oneRes && rs.length > 1) wrap.append(switcher(rs));
      const sel = res(selRes);
      colDefs = view === "week"
        ? Array.from({ length: 7 }, (_, i) => ({ date: add(weekStart(cur), i), res: sel }))
        : (mobile() ? [sel] : rs).map(r => ({ date: cur, res: r }));
      wrap.append(grid(st));
      return wrap;
    }
    function switchTab(k) { tab = k; SET("tab", k); root.querySelectorAll(".app-tabs button").forEach((b, i) => b.classList.toggle("on", ["schedule", "clients", "resources", "services", "settings"][i] === k)); anim = true; draw(); }

    function toolbar() {
      const t = Apps.today();
      const label = view === "week"
        ? `${fmtD(weekStart(cur))} – ${fmtD(add(weekStart(cur), 6), { month: "short", day: "numeric", year: "numeric" })}`
        : (cur === t ? "Today, " : "") + fmtD(cur, { weekday: cur === t ? undefined : "short", month: "long", day: "numeric" }) + (cur.slice(0, 4) !== t.slice(0, 4) ? ", " + cur.slice(0, 4) : "");
      const step = n => { cur = add(cur, view === "week" ? 7 * n : n); filter = ""; anim = true; draw(); };
      const cSw = h("span", { class: "switch" + (showCancelled ? " on" : "") });
      return h("div", { class: "app-toolbar bk-toolbar" },
        h("div", { class: "bk-nav" },
          h("button", { class: "btn", text: "Today", onclick: () => { cur = t; filter = ""; anim = true; draw(); } }),
          h("button", { class: "icon-btn", text: "‹", title: view === "week" ? "Previous week" : "Previous day", onclick: () => step(-1) }),
          h("button", { class: "icon-btn", text: "›", title: view === "week" ? "Next week" : "Next day", onclick: () => step(1) }),
          h("button", { class: "bk-date", title: "Pick a date", onclick: e => miniCal(e.currentTarget) }, h("span", { text: label }), h("i", { text: "▾" }))),
        h("span", { class: "grow" }),
        h("button", { class: "chip-btn", title: "Show cancelled bookings in the schedule", onclick: () => { showCancelled = !showCancelled; SET("cancelled", showCancelled ? "1" : ""); draw(); } }, cSw, "Cancelled"),
        h("div", { class: "seg bk-views" }, ...[["day", "Day"], ["week", "Week"]].map(([k, l]) => h("button", { class: view === k ? "on" : "", text: l, onclick: () => { view = k; SET("view", k); anim = true; draw(); } }))));
    }

    function miniCal(anchor) {
      let m = cur.slice(0, 8) + "01";
      const box = h("div", { class: "bk-mini" });
      const paint = () => {
        const gs = weekStart(m), t = Apps.today(), counts = {};
        bookings().forEach(b => { if (b.status !== "cancelled" && res(b.resource)) counts[b.date] = (counts[b.date] || 0) + 1; });
        box.replaceChildren(
          h("div", { class: "bk-mini-h" },
            h("button", { class: "icon-btn xs", text: "‹", title: "Previous month", onclick: () => { m = addMonth(m, -1); paint(); } }),
            h("b", { text: fmtD(m, { month: "long", year: "numeric" }) }),
            h("button", { class: "icon-btn xs", text: "›", title: "Next month", onclick: () => { m = addMonth(m, 1); paint(); } })),
          h("div", { class: "bk-mini-g" }, ...dayMini().map(d => h("span", { class: "bk-mini-wd", text: d })),
            ...Array.from({ length: 42 }, (_, i) => {
              const ds = add(gs, i), n = counts[ds] || 0;
              return h("button", { class: "bk-mini-d" + (ds.slice(0, 7) !== m.slice(0, 7) ? " other" : "") + (ds === t ? " today" : "") + (ds === cur ? " sel" : "") + (!hoursOf(ds) ? " closed" : ""),
                title: n ? `${n} booking${n > 1 ? "s" : ""}` : "", onclick: () => { cur = ds; filter = ""; api.close(); anim = true; draw(); } }, String(+ds.slice(8)), n ? h("i") : null);
            })),
          h("div", { class: "bk-mini-f" }, h("button", { class: "btn", text: "Today", onclick: () => { cur = Apps.today(); api.close(); anim = true; draw(); } })));
      };
      paint();
      const api = UI.popover(anchor, box);
    }

    function counters() {
      const dayB = bookings().filter(b => b.date === cur && res(b.resource));
      const live = unique(dayB.filter(b => b.status !== "cancelled"));
      const customers = new Set(live.filter(b => b.status !== "noshow" && b.client && b.client.name).map(b => clientKey(b.client) || b.id)).size;
      const revenue = live.reduce((a, b) => a + (+b.price || 0), 0);
      const unconf = unique(dayB.filter(b => status(b) === "unconfirmed")).length;
      const late = unique(dayB.filter(b => status(b) === "late")).length;
      const day = cur === Apps.today() ? "today" : fmtD(cur);
      const c = (k, ic, n, l, color) => h("button", { class: "bk-counter glass" + (filter === k ? " on" : ""), dataset: { c: color || "" }, title: filter === k ? "Show all bookings" : "Highlight these bookings",
        onclick: () => { filter = filter === k ? "" : k; draw(); } }, h("span", { class: "bk-cn-ic", text: ic }), h("span", { class: "bk-cn-t" }, h("b", { text: n }), h("small", { text: l })));
      return h("div", { class: "bk-counters" },
        c("all", "🗓️", String(live.length), "Bookings " + day),
        c("customers", "🙂", String(customers), "Customers " + day),
        c("revenue", "💰", money(revenue), "Revenue " + day, "green"),
        c("unconfirmed", "⏳", String(unconf), "Not confirmed", unconf ? "orange" : ""),
        c("late", "⏰", String(late), "Late", late ? "red" : ""));
    }
    const matches = b => {
      if (!filter) return true;
      if (filter === "all") return b.status !== "cancelled";
      if (filter === "customers") return b.status !== "cancelled" && b.status !== "noshow" && !!(b.client && b.client.name);
      if (filter === "revenue") return b.status !== "cancelled" && +b.price > 0;
      return status(b) === filter;
    };

    function switcher(rs) {
      return h("div", { class: "bk-switch" }, ...rs.map(r => h("button", { class: "bk-rchip" + (r.id === selRes ? " on" : ""), style: { "--c": r.color || PAL[0] },
        onclick: () => { selRes = r.id; SET("res", r.id); anim = true; draw(); } }, h("i"), r.name || "Resource")));
    }

    function setupCard(full) {
      const hasR = resources().length > 0, hasS = services().length > 0, hasB = bookings().length > 0;
      const steps = [
        [hasR, "Add a resource", "People, rooms or equipment that clients book", "Add a resource", () => editResource()],
        [hasS, "Add a service", "What clients book, how long it takes and what it costs", "Add a service", () => editService()],
        [hasB, "Make a booking", "Click any free slot in the schedule", "New booking", () => editBooking(null, { date: cur })],
      ];
      const firstTodo = steps.findIndex(s => !s[0]);
      return h("div", { class: "bk-setup glass" + (full ? " full" : "") },
        full ? h("div", { class: "bk-setup-hero" }, h("div", { class: "bk-setup-ic", text: "🗓️" }), h("h2", { text: "Let's set up booking" }), h("p", { text: "Three quick steps and your team can book clients into a shared schedule." })) : null,
        h("div", { class: "bk-steps" }, ...steps.map(([ok, t, sub, btn, fn], i) => h("div", { class: "bk-step" + (ok ? " ok" : "") + (i === firstTodo ? " next" : ""), style: { animationDelay: i * 70 + "ms" } },
          h("span", { class: "bk-step-n", text: ok ? "✓" : String(i + 1) }),
          h("div", { class: "bk-step-t" }, h("b", { text: t }), h("small", { text: sub })),
          ok ? null : h("button", { class: "btn" + (i === firstTodo ? " primary" : ""), text: btn, disabled: i === 2 && !hasR, onclick: fn })))),
        !hasR || !hasS ? h("div", { class: "bk-setup-foot" }, h("button", { class: "btn", text: "✨ Add sample setup", onclick: e => { e.currentTarget.disabled = true; sampleSetup(); } }),
          h("small", { text: "Adds 2 resources and 3 services you can change or delete later" })) : null);
    }

    function grid(st) {
      const t = Apps.today(), now = nowMin();
      // visible hours: working hours of the shown days plus any bookings outside them, one spare hour around
      let lo = Infinity, hi = -Infinity;
      colDefs.forEach(c => { const hr = hoursOf(c.date, st); if (hr) { lo = Math.min(lo, hr[0]); hi = Math.max(hi, hr[1]); } });
      const shown = bookings().filter(b => colDefs.some(c => c.date === b.date && c.res.id === b.resource) && (showCancelled || b.status !== "cancelled"));
      shown.forEach(b => { lo = Math.min(lo, startMin(b)); hi = Math.max(hi, endMin(b)); });
      if (lo === Infinity) { lo = 9 * 60; hi = 18 * 60; }
      gridFrom = Math.max(0, Math.floor(lo / 60) * 60 - 60); gridTo = Math.min(1440, Math.ceil(hi / 60) * 60 + 60);
      const H = (gridTo - gridFrom) / 60 * HOUR;

      const heads = colDefs.map(c => view === "week"
        ? h("button", { class: "bk-ch day" + (c.date === t ? " today" : "") + (!hoursOf(c.date, st) ? " closed" : ""), title: "Open this day", onclick: () => { cur = c.date; view = "day"; SET("view", "day"); anim = true; draw(); } },
          h("span", { text: fmtD(c.date, { weekday: "short" }) }), h("b", { text: String(+c.date.slice(8)) }), !hoursOf(c.date, st) ? h("small", { text: "Closed" }) : null)
        : (() => {
          const r = c.res, n = unique(bookings().filter(b => b.date === c.date && b.resource === r.id && b.status !== "cancelled")).length, p = r.person ? Data.person(r.person) : null;
          return h("button", { class: "bk-ch res", style: { "--c": r.color || PAL[0] }, title: "Open the week of " + (r.name || "this resource"), onclick: () => { selRes = r.id; SET("res", r.id); view = "week"; SET("view", "week"); anim = true; draw(); } },
            p ? Apps.avatar(p, 26) : h("span", { class: "bk-ch-ic", text: (TYPES[r.type] || TYPES.person)[0] }),
            h("span", { class: "bk-ch-t" }, h("b", { text: r.name || "Resource" }), h("small", { text: n ? `${n} booking${n > 1 ? "s" : ""}` : (TYPES[r.type] || TYPES.person)[1] })));
        })());

      const gut = h("div", { class: "bk-gut", style: { height: H + "px" } },
        ...Array.from({ length: (gridTo - gridFrom) / 60 }, (_, i) => i ? h("div", { class: "bk-hr", style: { top: i * HOUR + "px" }, text: hourLabel(gridFrom / 60 + i) }) : null));

      colEls = colDefs.map((c, ci) => {
        const col = h("div", { class: "bk-col" + (c.date === t ? " today" : ""), style: { height: H + "px" }, dataset: { i: ci } });
        const hr = hoursOf(c.date, st);
        const off = (a, b, txt) => b > a ? col.append(h("div", { class: "bk-off", style: { top: y(a) + "px", height: y(b) - y(a) + "px" } }, txt ? h("span", { text: txt }) : null)) : null;
        if (!hr) off(gridFrom, gridTo, "Closed"); else { off(gridFrom, hr[0]); off(hr[1], gridTo); }
        const list = shown.filter(b => b.date === c.date && b.resource === c.res.id).map(b => ({ b, s: startMin(b), e: Math.max(endMin(b), startMin(b) + 15) }));
        lanes(list);
        list.forEach(L => col.append(card(L, ci)));
        if (c.date === t && now >= gridFrom && now <= gridTo) col.append(h("div", { class: "bk-now", style: { top: y(now) + "px" } }));
        const ghost = h("div", { class: "bk-ghost", style: { height: slot / 60 * HOUR - 2 + "px" } });
        col.append(ghost);
        const slotAt = py => Math.max(gridFrom, Math.min(gridTo - slot, gridFrom + Math.floor(py / HOUR * 60 / slot) * slot));
        col.addEventListener("pointermove", e => {
          if (e.pointerType !== "mouse" || dragging || e.target !== col) { ghost.classList.remove("on"); return; }
          const m = slotAt(e.clientY - col.getBoundingClientRect().top);
          ghost.style.top = y(m) + 1 + "px"; ghost.textContent = "+ " + fmtM(m); ghost.classList.add("on");
        });
        col.addEventListener("pointerleave", () => ghost.classList.remove("on"));
        col.addEventListener("click", e => {
          if (e.target !== col || Date.now() - justDragged < 350) return;
          const m = slotAt(e.clientY - col.getBoundingClientRect().top);
          editBooking(null, { resource: c.res.id, date: c.date, start: toHM(m) });
        });
        return col;
      });

      const inner = h("div", { class: "bk-inner", style: { "--n": colDefs.length, "--hour": HOUR + "px", "--slotpx": slot / 60 * HOUR + "px" } },
        h("div", { class: "bk-corner", text: view === "week" ? (res(selRes)?.name || "") : "" }), ...heads, gut, ...colEls);
      return h("div", { class: "bk-tg glass" + (view === "week" ? " week" : "") + (colDefs.length === 1 ? " one" : "") }, h("div", { class: "bk-scroll" }, inner));
    }

    function card(L, ci) {
      const b = L.b, stt = status(b), sv = svc(b.service), short = L.e - L.s < 45, tiny = L.e - L.s < 30;
      const cls = "bk-card st-" + stt + (short ? " short" : "") + (tiny ? " tiny" : "") + (filter ? (matches(b) ? " hl" : " dim") : "");
      const act = (ic, title, fn) => h("button", { class: "bk-act", title, text: ic, onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); fn(e); } });
      const el = h("div", { class: cls, role: "button", tabindex: 0, title: `${clientName(b)}${sv ? " · " + sv.name : ""} · ${fmtT(b.start)} – ${fmtT(b.finish)} · ${STATUS[stt].label}`,
        style: { "--c": bColor(b), top: y(L.s) + 1 + "px", height: Math.max(L.e - L.s, 15) / 60 * HOUR - 3 + "px", left: `calc(${L.lane / L.lanes * 100}% + 3px)`, width: `calc(${100 / L.lanes}% - 6px)` },
        onclick: e => { e.stopPropagation(); if (Date.now() - justDragged < 350) return; editBooking(b); },
        onkeydown: e => { if (e.key === "Enter") editBooking(b); } },
        h("div", { class: "bk-c-top" },
          h("b", { class: "bk-c-name", text: clientName(b) }),
          b.group ? h("span", { class: "bk-c-ic", title: "Resource bundle", text: "🔗" }) : null,
          b.paid ? h("span", { class: "bk-paid", title: "Paid", text: "✓" }) : null,
          short ? h("span", { class: "bk-c-time", text: fmtT(b.start) }) : null),
        short ? null : h("div", { class: "bk-c-svc", text: [sv?.name, +b.price ? money(b.price) : ""].filter(Boolean).join(" · ") }),
        short ? null : h("div", { class: "bk-c-meta" }, h("span", { text: fmtT(b.start) + " – " + fmtT(b.finish) }), h("span", { class: "bk-badge st-" + stt, text: STATUS[stt].label })),
        h("div", { class: "bk-acts" },
          stt === "unconfirmed" ? act("👍", "Confirm", () => setStatus(b, "confirmed")) : null,
          stt === "confirmed" || stt === "unconfirmed" ? act("⏰", "Mark late", () => setStatus(b, "late")) : null,
          stt === "unconfirmed" || stt === "confirmed" || stt === "late" ? act("🏁", "Done", () => setStatus(b, "done")) : null,
          stt !== "cancelled" ? act("✕", "Cancel booking", () => setStatus(b, "cancelled")) : null,
          act("⋯", "More", e => statusMenu(e.currentTarget, b))),
        h("div", { class: "bk-rs", title: "Drag to change the length" }));
      el.addEventListener("pointerdown", pe => drag(pe, L, ci, el, pe.target.classList.contains("bk-rs") ? "size" : "move"));
      el.addEventListener("touchmove", te => { if (el.classList.contains("dragging")) te.preventDefault(); }, { passive: false });
      el.addEventListener("contextmenu", ce => { if (el.dataset.hold) ce.preventDefault(); });
      return el;
    }

    // pointer drag: move (time and column: resource in day view, day in week view) or resize from the bottom edge
    function drag(pe, L, ci0, el, mode) {
      if (pe.button !== 0 || pe.target.closest(".bk-acts")) return;
      const b = L.b, x0 = pe.clientX, y0 = pe.clientY, touch = pe.pointerType !== "mouse";
      const s0 = startMin(b), f0 = endMin(b), dur = f0 - s0, stepM = Math.min(slot, 15);
      let active = false, ns = s0, nf = f0, ci = ci0, hold = null;
      const meta = el.querySelector(".bk-c-meta span, .bk-c-time");
      const begin = () => { active = true; dragging = true; el.classList.add("dragging"); document.body.classList.add("bk-noselect"); try { navigator.vibrate?.(8); } catch {} };
      if (touch) { el.dataset.hold = "1"; hold = setTimeout(begin, 380); }
      const move = e => {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (!active) { if (Math.hypot(dx, dy) <= (touch ? 8 : 4)) return; if (touch) return stop(); begin(); }
        e.preventDefault();
        const dm = Math.round(dy / HOUR * 60 / stepM) * stepM;
        if (mode === "size") nf = Math.max(s0 + 15, Math.min(1439, f0 + dm));
        else {
          ns = Math.max(0, Math.min(1439 - dur, s0 + dm)); nf = ns + dur;
          const i = colEls.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
          if (i >= 0 && i !== ci) { ci = i; colEls[i].append(el); }
        }
        el.style.top = y(ns) + 1 + "px"; el.style.height = Math.max(nf - ns, 15) / 60 * HOUR - 3 + "px";
        if (meta) meta.textContent = meta.classList.contains("bk-c-time") ? fmtM(ns) : fmtM(ns) + " – " + fmtM(nf);
      };
      const stop = () => {
        clearTimeout(hold); delete el.dataset.hold;
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel);
        document.body.classList.remove("bk-noselect");
      };
      const up = () => {
        stop(); if (!active) return;
        justDragged = Date.now(); el.classList.remove("dragging"); dragging = false; pending = false;
        const c = colDefs[ci] || colDefs[ci0];
        commitMove(b, { date: c.date, resource: c.res.id, s: ns, f: nf });
      };
      const cancel = () => { stop(); if (active) { el.classList.remove("dragging"); dragging = false; pending = false; draw(); } };
      addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", cancel);
    }
    async function commitMove(b, to) {
      const g = groupOf(b), ids = g.map(x => x.id);
      let resource = to.resource;
      if (b.group && resource !== b.resource) { UI.toast("🔗 Bundle bookings keep their resources: only the time moved"); resource = b.resource; }
      const ds = to.s - startMin(b), df = to.f - endMin(b);
      const plan = g.map(x => x.id === b.id
        ? { x, resource, date: to.date, s: to.s, f: to.f }
        : { x, resource: x.resource, date: to.date, s: Math.max(0, startMin(x) + ds), f: Math.min(1439, endMin(x) + df) });
      const changed = plan.filter(p => p.resource !== p.x.resource || p.date !== p.x.date || p.s !== startMin(p.x) || p.f !== endMin(p.x));
      if (!changed.length) return draw();
      if (b.status !== "cancelled") {
        const cl = plan.flatMap(p => conflicts(p.resource, p.date, p.s, Math.max(p.f, p.s + 1), ids));
        if (cl.length && !await askOverlap(cl)) { draw(); return; }
      }
      for (const p of changed) {
        const patch = { resource: p.resource, date: p.date, start: toHM(p.s), finish: toHM(p.f) };
        Data.update("bookings", p.x.id, patch);
        if (p.resource !== p.x.resource) tellPerson({ ...p.x, ...patch });
      }
      UI.toast(`🗓️ ${clientName(b)} · ${fmtD(to.date, { weekday: "short", day: "numeric", month: "short" })}, ${fmtM(to.s)} – ${fmtM(to.f)}`);
    }

    /* ----- clients tab ----- */
    function clientsTab() {
      const listBox = h("div", { class: "bk-table" });
      const search = h("input", { class: "app-search", placeholder: "Search clients…", value: q });
      const paint = () => {
        const qq = q.trim().toLowerCase();
        const rows = clientsData().filter(c => !qq || [c.name, c.phone, c.email].join(" ").toLowerCase().includes(qq))
          .sort((a, b) => (b.last || b.next || "").localeCompare(a.last || a.next || "") || String(a.name).localeCompare(String(b.name)));
        if (!rows.length) { listBox.replaceChildren(Apps.empty("🙂", qq ? "No clients match." : "Clients appear here after their first booking.")); return; }
        listBox.replaceChildren(
          h("div", { class: "bk-tr head" }, h("span", { text: "Client" }), h("span", { text: "Contact" }), h("span", { text: "Visits" }), h("span", { text: "Last visit" }), h("span", { text: "Total spent" }), h("span", { text: "No-shows" })),
          ...rows.map((c, i) => h("button", { class: "bk-tr", style: { animationDelay: Math.min(i, 12) * 25 + "ms" }, onclick: () => clientPanel(c) },
            h("span", { class: "bk-tr-name" }, h("span", { class: "bk-client-av sm", text: (c.name || "?").trim()[0]?.toUpperCase() || "?" }), h("b", { text: c.name || "Client" }), c.contact ? h("small", { class: "bk-crm-tag", text: "CRM" }) : null),
            h("span", { class: "bk-muted", text: c.phone || c.email || "—" }),
            h("span", { text: String(c.visits) }),
            h("span", { text: c.last ? fmtD(c.last, { day: "numeric", month: "short", year: "numeric" }) : (c.next ? "Next " + fmtD(c.next) : "—") }),
            h("span", { text: money(c.spent) }),
            h("span", { class: c.noshows ? "bk-warn" : "bk-muted", text: String(c.noshows) }))));
      };
      search.addEventListener("input", () => { q = search.value; paint(); });
      paint();
      return h("div", { class: "bk-pane" },
        h("div", { class: "bk-sec-head" }, h("div", { class: "bk-sec-t" }, h("h3", { text: "Clients" }), h("small", { text: "Everyone you've booked, with their visits and spending" })), search),
        listBox);
    }

    /* ----- resources tab ----- */
    function resourcesTab() {
      const list = resources();
      const head = h("div", { class: "bk-sec-head" },
        h("div", { class: "bk-sec-t" }, h("h3", { text: "Resources" }), h("small", { text: "People, rooms and equipment that can be booked. Drag to reorder." })),
        h("button", { class: "btn", text: "🔗 Make resource bundle", onclick: () => editService(null, { bundle: true }) }),
        h("button", { class: "btn primary", text: "+ Add a resource", onclick: () => editResource() }));
      if (!list.length) return h("div", { class: "bk-pane" }, head, setupCard(true));
      let dragId = null;
      const reorder = (id, beforeId) => {
        const ids = list.map(r => r.id).filter(x => x !== id);
        const i = beforeId ? ids.indexOf(beforeId) : ids.length; ids.splice(i < 0 ? ids.length : i, 0, id);
        ids.forEach((x, n) => { const r = res(x); if (r && r.order !== n) Data.update("bookings", x, { order: n }); });
      };
      const rows = list.map((r, i) => {
        const p = r.person ? Data.person(r.person) : null, nS = services().filter(s => (s.resources || []).includes(r.id)).length;
        const on = r.active !== false, sw = h("span", { class: "switch" + (on ? " on" : "") });
        const row = h("div", { class: "bk-item" + (on ? "" : " off"), draggable: true, style: { "--c": r.color || PAL[0], animationDelay: Math.min(i, 12) * 30 + "ms" }, dataset: { id: r.id } },
          h("span", { class: "bk-grip", title: "Drag to reorder", text: "⠿" }),
          h("span", { class: "bk-dot" }),
          h("button", { class: "bk-item-main", onclick: () => editResource(r) },
            h("b", { text: r.name || "Resource" }),
            h("small", { text: [(TYPES[r.type] || TYPES.person).join(" "), p ? "linked to " + p.name : "", nS ? `${nS} service${nS > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") })),
          p ? Apps.avatar(p, 26) : null,
          h("button", { class: "chip-btn", title: on ? "Shown in the schedule" : "Hidden from the schedule", onclick: () => Data.update("bookings", r.id, { active: !on }) }, sw, on ? "Active" : "Off"),
          h("button", { class: "icon-btn xs", title: "Move up", text: "↑", disabled: i === 0, onclick: () => reorder(r.id, list[i - 1].id) }),
          h("button", { class: "icon-btn xs", title: "Move down", text: "↓", disabled: i === list.length - 1, onclick: () => reorder(r.id, list[i + 2]?.id || null) }),
          h("button", { class: "icon-btn xs", title: "Edit", text: "✏️", onclick: () => editResource(r) }));
        row.addEventListener("dragstart", e => { dragId = r.id; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", r.id); } catch {} setTimeout(() => row.classList.add("dragging")); });
        row.addEventListener("dragend", () => { row.classList.remove("dragging"); dragId = null; });
        row.addEventListener("dragover", e => { if (!dragId || dragId === r.id) return; e.preventDefault(); const rc = row.getBoundingClientRect(); row.classList.toggle("drop-a", e.clientY < rc.top + rc.height / 2); row.classList.toggle("drop-b", e.clientY >= rc.top + rc.height / 2); });
        row.addEventListener("dragleave", () => row.classList.remove("drop-a", "drop-b"));
        row.addEventListener("drop", e => {
          e.preventDefault(); const after = row.classList.contains("drop-b"); row.classList.remove("drop-a", "drop-b");
          if (!dragId || dragId === r.id) return;
          const id = dragId; dragId = null;
          reorder(id, after ? (list[i + 1]?.id === id ? list[i + 2]?.id : list[i + 1]?.id) || null : r.id);
        });
        return row;
      });
      return h("div", { class: "bk-pane" }, head, h("div", { class: "bk-items" }, ...rows));
    }

    /* ----- services tab ----- */
    function servicesTab() {
      const list = services(), cur$ = S().currency;
      const head = h("div", { class: "bk-sec-head" },
        h("div", { class: "bk-sec-t" }, h("h3", { text: "Services" }), h("small", { text: "What clients book: duration, price and who provides it" })),
        h("button", { class: "btn", text: "🔗 Make resource bundle", onclick: () => editService(null, { bundle: true }) }),
        h("button", { class: "btn primary", text: "+ Add a service", onclick: () => editService() }));
      if (!list.length) return h("div", { class: "bk-pane" }, head, Apps.empty("✂️", "No services yet. Add what clients can book.", h("button", { class: "btn primary", text: "+ Add a service", onclick: () => editService() })));
      return h("div", { class: "bk-pane" }, head, h("div", { class: "bk-svcs" }, ...list.map((s, i) => {
        const rs = (s.resources || []).map(res).filter(Boolean), p = s.product && Data.get("products", s.product);
        const n = unique(bookings().filter(b => b.service === s.id && b.status !== "cancelled")).length;
        return h("button", { class: "bk-svc glass", style: { "--c": s.color || PAL[0], animationDelay: Math.min(i, 12) * 35 + "ms" }, onclick: () => editService(s) },
          h("div", { class: "bk-svc-top" }, h("b", { text: s.name || "Service" }), s.bundle ? h("span", { class: "bk-tag", text: "🔗 Bundle" }) : null),
          h("div", { class: "bk-svc-price" }, h("span", { text: money(s.price, cur$) }), h("small", { text: durTxt(+s.duration || 60) })),
          h("div", { class: "bk-chips" }, ...(rs.length ? rs.map(r => h("span", { class: "bk-rchip static", style: { "--c": r.color || PAL[0] } }, h("i"), r.name || "Resource")) : [h("small", { class: "bk-muted", text: "Any resource" })])),
          h("div", { class: "bk-svc-foot" }, h("small", { text: n ? `${n} booking${n > 1 ? "s" : ""}` : "Not booked yet" }), p ? h("small", { text: "📦 " + (p.name || "Product") }) : null));
      })));
    }

    /* ----- settings tab ----- */
    function settingsTab() {
      const st = S(), hours = JSON.parse(JSON.stringify(st.hours));
      let slotV = st.slot, currency = st.currency;
      const rows = DAYS.map((d, i) => {
        const open = Array.isArray(hours[d]);
        const a = h("input", { class: "menu-input", type: "time", step: 300, value: open ? hours[d][0] : openT(), disabled: !open });
        const b = h("input", { class: "menu-input", type: "time", step: 300, value: open ? hours[d][1] : closeT(), disabled: !open });
        const sw = h("span", { class: "switch" + (open ? " on" : "") });
        const row = h("div", { class: "bk-hrow" + (open ? "" : " off") },
          h("button", { class: "chip-btn", onclick: () => { const on = !Array.isArray(hours[d]); hours[d] = on ? [a.value || openT(), b.value || closeT()] : null; sw.classList.toggle("on", on); a.disabled = b.disabled = !on; row.classList.toggle("off", !on); } }, sw, h("b", { text: DAY_LONG[i] })),
          a, h("span", { class: "bk-muted", text: "–" }), b);
        const upd = () => { if (Array.isArray(hours[d])) hours[d] = [a.value, b.value]; };
        a.addEventListener("change", upd); b.addEventListener("change", upd);
        return row;
      });
      const slotSeg = h("div", { class: "seg" }, ...[15, 30, 60].map(m => h("button", { class: m === slotV ? "on" : "", text: m + " min", onclick: e => { slotV = m; slotSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } })));
      const curs = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];
      const curSel = h("select", { class: "menu-input bk-cur" }, ...curs.map(c => h("option", { value: c, selected: c === currency }, c)));
      curSel.onchange = () => (currency = curSel.value);
      const save = () => {
        for (const d of DAYS) { const x = hours[d]; if (Array.isArray(x) && !(toMin(x[1]) > toMin(x[0]))) return UI.toast(`${DAY_LONG[DAYS.indexOf(d)]}: closing time must be after opening time`); }
        Data.update("settings", "booking", { hours, slot: slotV, currency });
        UI.toast("✅ Booking settings saved");
      };
      return h("div", { class: "bk-pane bk-settings" },
        h("div", { class: "bk-sec-head" }, h("div", { class: "bk-sec-t" }, h("h3", { text: "Settings" }), h("small", { text: "Working hours, slot size and currency for the whole team" }))),
        h("div", { class: "bk-set glass" },
          h("div", { class: "bk-set-h" }, h("b", { text: "Working hours" }), h("button", { class: "btn bk-copy", text: "Copy Monday to weekdays", onclick: () => {
            const mon = hours.mon; ["tue", "wed", "thu", "fri"].forEach(d => { hours[d] = mon ? [...mon] : null; });
            rows.forEach((row, i) => { if (i < 1 || i > 4) return; const on = Array.isArray(hours[DAYS[i]]); const ins = row.querySelectorAll("input"); row.classList.toggle("off", !on); row.querySelector(".switch").classList.toggle("on", on); ins.forEach((x, j) => { x.disabled = !on; if (on) x.value = hours[DAYS[i]][j]; }); });
          } })),
          h("div", { class: "bk-hours" }, ...rows)),
        h("div", { class: "bk-set glass" },
          h("div", { class: "bk-set-row" }, h("div", null, h("b", { text: "Slot size" }), h("small", { text: "Grid lines and the times offered when you click the schedule" })), slotSeg),
          h("div", { class: "bk-set-row" }, h("div", null, h("b", { text: "Currency" }), h("small", { text: "Used for service prices, revenue and clients' spending" })), curSel)),
        h("div", { class: "bk-set-foot" }, h("button", { class: "btn primary big", text: "Save settings", onclick: save })));
    }

    /* ----- draw ----- */
    function draw() {
      if (dragging) { pending = true; return; }
      const sc = body.querySelector(".bk-scroll"), top = sc ? sc.scrollTop : 0, left = sc ? sc.scrollLeft : 0;
      const el = tab === "clients" ? clientsTab() : tab === "resources" ? resourcesTab() : tab === "services" ? servicesTab() : tab === "settings" ? settingsTab() : schedule();
      if (anim) { el.classList.add("bk-anim"); anim = false; }
      body.replaceChildren(el);
      const ns = body.querySelector(".bk-scroll");
      if (ns) {
        const key = view + (view === "week" ? weekStart(cur) + selRes : cur);
        if (key === scrollKey && sc) { ns.scrollTop = top; ns.scrollLeft = left; }
        else { const t = Apps.today(), inView = colDefs.some(c => c.date === t), now = nowMin(); ns.scrollTop = inView && now > gridFrom && now < gridTo ? Math.max(0, y(now) - 140) : HOUR * .6; }
        scrollKey = key;
      } else scrollKey = "";
    }
    const redraw = UI.liveDraw(root, draw);
    const onData = () => { if (ready && tab !== "settings") redraw(); };
    const offs = ["bookings", "settings", "people", "products"].map(c => Data.on(c, onData));
    ready = true;
    draw();
    const tick = setInterval(() => { if (tab === "schedule") redraw(); }, 60000);
    let rT = 0;
    const onResize = () => { clearTimeout(rT); rT = setTimeout(() => { if (mobile() !== wasMobile) { wasMobile = mobile(); if (tab === "schedule") draw(); } }, 150); };
    addEventListener("resize", onResize);

    // deep link: #/app/booking/<bookingId>
    if (arg) {
      let opened = false, tries = 0;
      const tryOpen = () => {
        if (opened) return true;
        const b = Data.get("bookings", arg);
        if (!b || b.kind !== "booking") return false;
        opened = true;
        if (tab !== "schedule") switchTab("schedule");
        cur = b.date; selRes = b.resource; anim = true; draw();
        setTimeout(() => { editBooking(b); try { history.replaceState(null, "", "#/app/booking"); } catch {} }, 80);
        return true;
      };
      if (!tryOpen()) {
        const off = Data.on("bookings", () => { if (tryOpen() || ++tries > 30) setTimeout(() => off()); });
        offs.push(off);
        setTimeout(() => { if (!opened) UI.toast("That booking isn't available"); }, 8000);
      }
    }
    return () => { clearInterval(tick); clearTimeout(rT); removeEventListener("resize", onResize); offs.forEach(f => f()); };
  }

  /* ---------- reminders: run all the time, whether or not Booking is open ---------- */
  const remKey = () => "lumen-booking-reminded-" + (window.Cloud?.ws?.id || "local");
  function remindTick() {
    if (!window.Data || !window.Apps?.today || !window.Notify?.alert) return;
    const now = Date.now(), t = Apps.today(), tm = add(t, 1), mine = me();
    let fired; try { fired = JSON.parse(localStorage.getItem(remKey())) || {}; } catch { fired = {}; }
    let changed = false;
    Data.list("bookings").forEach(b => {
      if (b.kind !== "booking" || b.deleted || (b.date !== t && b.date !== tm)) return;
      if (b.status === "cancelled" || b.status === "noshow" || b.status === "done") return;
      const r = res(b.resource); if (!r || !r.person || r.person !== mine) return;
      const at = startAt(b), k = b.id + "|" + b.date + "|" + b.start;
      if (now < at - 15 * 60000 || now > at + 60000 || fired[k]) return;
      fired[k] = now; changed = true;
      const mins = Math.round((at - now) / 60000);
      Notify.alert({ title: `🗓️ ${clientName(b)} ${mins > 0 ? `in ${mins} min` : "is due now"}`, body: [svc(b.service)?.name, fmtT(b.start) + " – " + fmtT(b.finish), r.name].filter(Boolean).join(" · "),
        link: link(b.id), icon: "🗓️", tag: "bk-" + b.id });
    });
    if (changed) {
      for (const x in fired) if (now - fired[x] > 3 * 864e5) delete fired[x];
      try { localStorage.setItem(remKey(), JSON.stringify(fired)); } catch {}
    }
  }
  const safeTick = () => { try { remindTick(); } catch (e) { console.warn("booking reminders", e); } };
  setInterval(safeTick, 60000);
  setTimeout(safeTick, 9000);

  Apps.register("booking", { title: "Booking", icon: "🗓️", render });
  Apps.Booking = { editBooking, editResource, editService };
})();
