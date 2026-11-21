/* Inventory (Bitrix24-style): warehouses, stock receipts, sales orders, transfers, write-offs, stock levels, analytics.
   Data: `inventory` docs — kind "warehouse" { name, address, default, deleted? } and kind "doc"
   { type, number, date, warehouse, to, vendor, deal, reason, items: [{ product, qty, price }], status, note, doneBy, doneAt }.
   Stock = sum of conducted ("done") docs. Products come from the shared `products` catalog. */
(function () {
  const { h, esc } = UI;
  const COL = "inventory";
  const TYPES = {
    receipt: { tab: "receipts", label: "Receipt", plural: "receipts", prefix: "REC-", icon: "📥", print: "Goods receipt", price: "Purchase price", sign: ["Delivered by", "Received by"] },
    sale: { tab: "sales", label: "Sales order", plural: "sales orders", prefix: "SO-", icon: "📤", print: "Delivery note", price: "Sale price", sign: ["Released by", "Received by"] },
    transfer: { tab: "transfers", label: "Transfer", plural: "transfers", prefix: "TR-", icon: "🔁", print: "Transfer note", price: "Cost", sign: ["Sent by", "Received by"] },
    writeoff: { tab: "writeoffs", label: "Write-off", plural: "write-offs", prefix: "WO-", icon: "🗑️", print: "Write-off act", price: "Cost", sign: ["Prepared by", "Approved by"] },
  };
  const TAB_TYPE = { receipts: "receipt", sales: "sale", transfers: "transfer", writeoffs: "writeoff" };
  const TABS = [["stock", "Stock"], ["receipts", "Receipts"], ["sales", "Sales orders"], ["transfers", "Transfers"], ["writeoffs", "Write-offs"], ["warehouses", "Warehouses"], ["analytics", "Analytics"]];
  const REASONS = [["damaged", "Damaged"], ["expired", "Expired"], ["lost", "Lost"], ["other", "Other"]];
  const STATUS = { draft: ["Draft", "gray"], done: ["Conducted", "green"], cancelled: ["Cancelled", "red"] };
  const TAB_KEY = "lumen-inventory-tab";

  /* ---------- small helpers ---------- */
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const fq = n => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const money = n => Apps.money(n);
  const price = n => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: Apps.currency(), maximumFractionDigits: 2 }).format(+n || 0); } catch { return (+n || 0).toFixed(2); } };
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  const longDate = d => d ? new Date(d + "T00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const reasonLabel = r => (REASONS.find(x => x[0] === r) || [, r ? String(r) : "—"])[1];

  const allWh = () => Data.list(COL).filter(x => x.kind === "warehouse");
  const warehouses = () => allWh().filter(w => !w.deleted).sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")));
  const whName = id => { const w = id && Data.get(COL, id); return w ? (w.name || "Untitled warehouse") + (w.deleted ? " (deleted)" : "") : (id ? "Deleted warehouse" : "—"); };
  const defaultWh = () => (warehouses().find(w => w.default) || warehouses()[0] || {}).id || "";
  const docs = () => Data.list(COL).filter(x => x.kind === "doc" && !x.deleted);
  const products = () => Data.list("products").filter(p => !p.deleted);
  const prod = id => id ? Data.get("products", id) : null;
  const pName = id => prod(id)?.name || "Deleted product";
  const compName = id => (id && Data.get("companies", id)?.name) || "";
  const dealName = id => (id && Data.get("deals", id)?.title) || "";
  const docTotal = d => (d.items || []).reduce((a, it) => a + num(it.qty) * num(it.price), 0);
  const docDate = d => d.date || (d.at ? Apps.iso(new Date(d.at)) : "");
  const ord = d => docDate(d) + "|" + String(d.doneAt || d.at || 0).padStart(15, "0");
  const chip = (label, color, extra) => h("span", { class: "tag inv-tag", dataset: { tc: color }, text: label, title: extra || null });
  const statusChip = d => { const s = STATUS[d.status] || STATUS.draft; return chip(s[0], s[1]); };
  const counterparty = d => d.type === "receipt" ? compName(d.vendor) : d.type === "sale" ? dealName(d.deal) : d.type === "writeoff" ? reasonLabel(d.reason) : whName(d.to);

  /* ---------- stock engine (cached, rebuilt when `inventory` changes) ---------- */
  let comp = null;
  const invalidate = () => { comp = null; };
  // signed stock moves of one document
  function deltas(d) {
    const out = [];
    (d.items || []).forEach(it => {
      const q = num(it.qty); if (!it.product || !q) return;
      if (d.type === "receipt") out.push({ product: it.product, wh: d.warehouse, qty: q });
      else if (d.type === "sale" || d.type === "writeoff") out.push({ product: it.product, wh: d.warehouse, qty: -q });
      else if (d.type === "transfer") { out.push({ product: it.product, wh: d.warehouse, qty: -q }); if (d.to) out.push({ product: it.product, wh: d.to, qty: q }); }
    });
    return out;
  }
  function compute() {
    if (comp) return comp;
    const stock = {}, moves = {}, lastSale = {}, lastCost = {};
    const done = docs().filter(d => d.status === "done").sort((a, b) => ord(a).localeCompare(ord(b)));
    done.forEach(d => {
      deltas(d).forEach(m => { const s = stock[m.product] ||= {}; s[m.wh] = (s[m.wh] || 0) + m.qty; });
      const per = {};
      (d.items || []).forEach(it => { if (it.product && num(it.qty)) per[it.product] = (per[it.product] || 0) + num(it.qty); });
      const sign = d.type === "receipt" ? 1 : d.type === "transfer" ? 0 : -1;
      Object.entries(per).forEach(([pid, q]) => {
        (moves[pid] ||= []).push({ doc: d, qty: q, net: sign * q });
        if (d.type === "sale") lastSale[pid] = docDate(d);
      });
      if (d.type === "receipt") (d.items || []).forEach(it => { if (it.product && num(it.price)) lastCost[it.product] = num(it.price); });
    });
    return (comp = { stock, moves, lastSale, lastCost, done });
  }
  function stockOf(pid, wid) {
    const s = compute().stock[pid] || {};
    return wid ? (s[wid] || 0) : Object.values(s).reduce((a, b) => a + b, 0);
  }
  function valueOf(wid) {
    const st = compute().stock;
    return Object.keys(st).reduce((a, pid) => { const p = prod(pid); return p && !p.deleted ? a + stockOf(pid, wid) * num(p.price) : a; }, 0);
  }
  // products whose stock we show: tracked ones, or any product that moved in a conducted document
  const tracked = () => { const mv = compute().moves; return products().filter(p => p.track || mv[p.id]); };
  function levelOf(p, q = stockOf(p.id)) {
    const min = num(p.minStock);
    if (q <= 0) return "out";
    if (min > 0 && q <= min) return "low";
    return "ok";
  }
  const LEVEL = { ok: ["In stock", "green"], low: ["Low", "orange"], out: ["Out of stock", "red"] };
  const levelChip = p => { const l = LEVEL[levelOf(p)]; return chip(l[0], l[1], num(p.minStock) ? "Minimum " + fq(p.minStock) : ""); };
  const lowList = () => tracked().filter(p => levelOf(p) !== "ok");
  const defaultPrice = (p, type) => type === "sale" ? num(p.price) : (compute().lastCost[p.id] || num(p.cost) || num(p.price));
  function costOf(pid) { const p = prod(pid); return compute().lastCost[pid] || num(p?.cost) || num(p?.price); }

  /* ---------- sidebar badge: low or out-of-stock tracked products, live ---------- */
  const paintBadge = () => { try { Apps.badge("inventory", lowList().length); } catch (e) { console.warn(e); } };
  let watching = false;
  function startWatch() {
    if (watching) return; watching = true;
    // listeners survive workspace switches (Data.reset re-emits to them), so subscribe once
    Data.on(COL, () => { invalidate(); paintBadge(); });
    Data.on("products", paintBadge);
  }
  setTimeout(startWatch, 0);

  function nextNumber(type) {
    let max = 0;
    Data.list(COL).forEach(d => { if (d.kind === "doc" && d.type === type) { const m = String(d.number || "").match(/(\d+)\s*$/); if (m) max = Math.max(max, +m[1]); } });
    return TYPES[type].prefix + String(max + 1).padStart(4, "0");
  }

  /* ---------- pickers ---------- */
  function pickerPop(anchor, { placeholder, items, onPick, footer, width }) {
    const inp = h("input", { class: "menu-input", placeholder }), list = h("div", { class: "inv-pick-list" });
    let api;
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      const rows = items().filter(x => !q || (x.label + " " + (x.sub || "") + " " + (x.search || "")).toLowerCase().includes(q)).slice(0, 80);
      list.replaceChildren(...rows.map(x => h("button", { class: "mi compact inv-pick", type: "button", onclick: () => { api.close(); onPick(x.value); } },
        h("span", { class: "mi-ic", text: x.icon || "•" }),
        h("span", { class: "inv-pick-t" }, h("span", { text: x.label }), x.sub ? h("small", { text: x.sub }) : null),
        x.right ? h("span", { class: "mi-k", text: x.right }) : null)));
      if (!rows.length) list.append(h("div", { class: "menu-empty", text: q ? "Nothing found" : "Nothing here yet" }));
    };
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { const b = list.querySelector("button"); if (b) { e.preventDefault(); b.click(); } } });
    draw();
    api = UI.popover(anchor, h("div", { class: "inv-pick-pop", style: { width: (width || 300) + "px" } }, inp, list, footer ? footer(() => api.close()) : null));
    setTimeout(() => inp.focus(), 30);
    return api;
  }
  const newRow = (label, run) => h("button", { class: "mi compact inv-pick-new", type: "button", onclick: run }, h("span", { class: "mi-ic", text: "＋" }), h("span", { class: "mi-t", text: label }));

  const productFields = () => [{ key: "name", label: "Product name", required: true }, { key: "sku", label: "SKU", half: true }, { key: "unit", label: "Unit", half: true, placeholder: "pcs" },
    { key: "price", label: "Sale price", type: "number", half: true }, { key: "minStock", label: "Minimum stock", type: "number", half: true }, { key: "track", label: "Count stock for this product", type: "checkbox" }];
  // new catalog product: the Sales catalog editor when it's there, else a small form of our own
  async function newProduct() {
    if (Apps.Sales && typeof Apps.Sales.editProduct === "function") {
      const id = await Apps.Sales.editProduct();
      const p = id && prod(id);
      if (p && p.track == null && p.kind !== "service") Data.update("products", id, { track: true });
      return id || null;
    }
    const v = await Apps.form("New product", productFields(), { unit: "pcs", track: true }, { ok: "Create" });
    if (!v) return null;
    return Data.add("products", { name: v.name.trim(), sku: (v.sku || "").trim(), kind: "product", price: num(v.price), unit: (v.unit || "pcs").trim() || "pcs", tax: 0, category: "", desc: "", active: true, track: !!v.track, minStock: num(v.minStock) });
  }
  async function editProduct(p) {
    if (!p) return null;
    if (Apps.Sales && typeof Apps.Sales.editProduct === "function") return Apps.Sales.editProduct(p);
    const v = await Apps.form("Edit product", productFields(), { ...p, track: p.track !== false });
    if (!v) return null;
    Data.update("products", p.id, { name: v.name.trim(), sku: (v.sku || "").trim(), price: num(v.price), unit: (v.unit || "pcs").trim() || "pcs", minStock: num(v.minStock), track: !!v.track });
    return p.id;
  }
  async function stockSettings(p) {
    const v = await Apps.form("Stock settings", [{ key: "minStock", label: "Minimum stock (you're alerted at or below it)", type: "number" }, { key: "track", label: "Count stock for this product", type: "checkbox" }],
      { minStock: p.minStock ?? "", track: p.track !== false }, { width: 440 });
    if (v) Data.update("products", p.id, { minStock: num(v.minStock), track: !!v.track });
  }

  function pickProduct(anchor, onPick, wh) {
    if (Apps.Sales && typeof Apps.Sales.productPicker === "function") {
      try { return Apps.Sales.productPicker(anchor, p => { if (p && p.id) onPick(p); }); } catch (e) { console.warn("Sales product picker failed, using the built-in one", e); }
    }
    pickerPop(anchor, {
      placeholder: "Search products…", width: 320,
      items: () => products().filter(p => p.active !== false).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map(p => ({
        label: p.name || "Untitled", sub: [p.sku, p.unit].filter(Boolean).join(" · "), search: p.category || "", icon: p.kind === "service" ? "🛠️" : "📦", value: p,
        right: (p.track || compute().moves[p.id]) ? fq(stockOf(p.id, wh)) + " " + (p.unit || "pcs") : "" })),
      onPick,
      footer: close => newRow("New product", async () => { close(); const id = await newProduct(); const p = id && prod(id); if (p) onPick(p); }),
    });
  }
  function pickVendor(anchor, onPick) {
    pickerPop(anchor, {
      placeholder: "Search companies…",
      items: () => [{ label: "No vendor", value: "", icon: "∅" }, ...Data.list("companies").filter(c => !c.deleted)
        .sort((a, b) => (b.type === "vendor" ? 1 : 0) - (a.type === "vendor" ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")))
        .map(c => ({ label: c.name || "Untitled company", sub: c.type === "vendor" ? "Vendor" : c.type ? c.type[0].toUpperCase() + c.type.slice(1) : c.industry || "", value: c.id, icon: "🏢" }))],
      onPick,
      footer: close => newRow("New vendor", async () => {
        close();
        const v = await Apps.form("New vendor", [{ key: "name", label: "Company name", required: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "website", label: "Website", half: true }], {}, { ok: "Create" });
        if (v) onPick(await Data.add("companies", { name: v.name.trim(), phone: v.phone || "", website: v.website || "", type: "vendor", activities: [] }));
      }),
    });
  }
  function pickDeal(anchor, onPick) {
    const closed = d => ["won", "lost"].includes(d.stage);
    pickerPop(anchor, {
      placeholder: "Search deals…", width: 320,
      items: () => [{ label: "No deal", value: "", icon: "∅" }, ...Data.list("deals").filter(d => !d.deleted)
        .sort((a, b) => (closed(a) ? 1 : 0) - (closed(b) ? 1 : 0) || (b.at || 0) - (a.at || 0))
        .map(d => ({ label: d.title || "Untitled deal", sub: [compName(d.company), (d.products || []).length ? d.products.length + " products" : ""].filter(Boolean).join(" · "), right: money(d.amount), value: d.id, icon: "💼" }))],
      onPick,
    });
  }

  /* ---------- confirmations ---------- */
  function shortages(doc, sign) {
    const need = {};
    deltas(doc).forEach(m => { const k = m.product + "|" + m.wh; need[k] = (need[k] || 0) + m.qty * sign; });
    return Object.entries(need).filter(([, q]) => q < 0).map(([k, q]) => { const [pid, wh] = k.split("|"); return { pid, wh, need: -q, have: stockOf(pid, wh) }; })
      .filter(s => s.have - s.need < -1e-9);
  }
  function shortDialog(short, mode) {
    return new Promise(res => {
      let done = false;
      const rows = short.map(s => h("div", { class: "inv-short-row" },
        h("span", { class: "inv-short-p" }, h("b", { text: pName(s.pid) }), h("small", { text: whName(s.wh) })),
        h("span", { class: "num", text: `need ${fq(s.need)} · have ${fq(s.have)}` }),
        h("span", { class: "inv-short-gap num", text: "short " + fq(s.need - s.have) })));
      const body = h("div", { class: "inv-short" },
        h("p", { text: mode === "cancel" ? "Cancelling this document would leave negative stock for:" : "There isn't enough stock to conduct this document:" }),
        h("div", { class: "inv-short-list" }, ...rows),
        h("p", { class: "inv-short-hint", text: "You can still go ahead: the stock will show below zero until more arrives." }),
        h("div", { class: "inv-dlg-acts" }, h("button", { class: "btn", text: "Go back", onclick: () => m.close() }),
          h("button", { class: "btn danger", text: mode === "cancel" ? "Cancel conduct anyway" : "Conduct anyway", onclick: () => { done = true; res(true); m.close(); } })));
      const m = UI.modal("⚠️ Not enough stock", body, { onClose: () => !done && res(false) });
      m.el.style.width = "540px";
    });
  }
  // after a conduct / cancel: alert me about products that just dropped to or below their minimum
  function lowAlerts(pids, before) {
    invalidate();
    const hits = pids.map(pid => {
      const p = prod(pid); if (!p) return null;
      const min = num(p.minStock), lim = min > 0 ? min : 0, q = stockOf(pid);
      return q <= lim && (before[pid] ?? Infinity) > lim ? { p, q, min } : null;
    }).filter(Boolean);
    hits.slice(0, 3).forEach(({ p, q, min }) => {
      const title = (q <= 0 ? "Out of stock: " : "Low stock: ") + (p.name || "product");
      const body = `${fq(q)} ${p.unit || "pcs"} left` + (min > 0 ? ` · minimum ${fq(min)}` : "");
      if (window.Notify?.alert) Notify.alert({ title: "📦 " + title, body, link: "#/app/inventory/stock", icon: "📦", tag: "inv-low-" + p.id, dedupe: "inv-low-" + p.id + "-" + Date.now() });
      else UI.toast("📦 " + title + " (" + body + ")");
    });
    if (hits.length > 3) UI.toast(`📦 ${hits.length} products are now low on stock`);
    paintBadge();
  }
  function validate(d) {
    if (!d.warehouse || !Data.get(COL, d.warehouse)) return d.type === "transfer" ? "Choose the warehouse to move from" : "Choose a warehouse";
    if (d.type === "transfer") { if (!d.to || !Data.get(COL, d.to)) return "Choose the destination warehouse"; if (d.to === d.warehouse) return "Pick two different warehouses"; }
    if (!d.items.length) return "Add at least one product";
    if (d.items.some(it => !(num(it.qty) > 0))) return "Every line needs a quantity above zero";
    return "";
  }

  /* ---------- document editor (receipts, sales orders, transfers, write-offs) ---------- */
  function openDoc(ref, type, preset) {
    const existing = ref ? Data.get(COL, ref) : null;
    if (ref && !existing) return UI.toast("That document is no longer available");
    type = existing ? existing.type : type;
    const T = TYPES[type]; if (!T) return;
    const whs0 = warehouses();
    let d = existing ? clone(existing) : {
      kind: "doc", type, number: nextNumber(type), date: Apps.today(), warehouse: defaultWh(), to: type === "transfer" ? ((whs0.find(w => w.id !== defaultWh()) || {}).id || "") : "",
      vendor: "", deal: "", reason: type === "writeoff" ? "damaged" : "", items: [], status: "draft", note: "", ...(preset || {}),
    };
    d.items = (d.items || []).map(it => ({ product: it.product, qty: it.qty, price: it.price }));
    let id = existing ? existing.id : null, dirty = !!(preset && (preset.items || []).length), closing = false;
    const body = h("div", { class: "inv-doc" });
    const cleanItems = () => d.items.filter(it => it.product).map(it => ({ product: it.product, qty: num(it.qty), price: num(it.price) }));
    const snapshot = () => ({ ...d, items: cleanItems() });
    const pnl = Apps.panel(T.label, body, [h("button", { class: "btn", text: "🖨️ Print", onclick: () => printDoc(snapshot()) })]);
    const off = Data.on(COL, () => {
      if (!id || closing) return;
      const cur = Data.get(COL, id);
      if (!cur) { closing = true; dirty = false; UI.toast("This document was deleted"); pnl.close(); return; }
      if (cur.status !== d.status) { d = clone(cur); d.items = d.items || []; dirty = false; draw(); }
    });
    pnl.onClose = () => {
      off();
      if (dirty && d.status !== "done" && !closing) save(true).then(ok => ok && UI.toast(`💾 Draft ${d.number} saved`));
    };

    async function save(quiet) {
      d.number = String(d.number || "").trim() || nextNumber(d.type);
      const taken = Data.list(COL).some(x => x.kind === "doc" && x.type === d.type && x.id !== id && !x.deleted && String(x.number || "").trim().toLowerCase() === d.number.toLowerCase());
      if (taken) { if (!quiet) { UI.toast(`${d.number} is already used. Pick another number.`); return false; } d.number = nextNumber(d.type); }
      const patch = { number: d.number, date: d.date || Apps.today(), warehouse: d.warehouse || "", to: d.type === "transfer" ? d.to || "" : "", vendor: d.type === "receipt" ? d.vendor || "" : "",
        deal: d.type === "sale" ? d.deal || "" : "", reason: d.type === "writeoff" ? d.reason || "other" : "", items: cleanItems(), note: d.note || "" };
      if (!id) { id = await Data.add(COL, { kind: "doc", type: d.type, status: "draft", ...patch }); d.id = id; }
      else await Data.update(COL, id, patch);
      dirty = false;
      return true;
    }
    async function conduct() {
      const items = cleanItems(), doc = { ...d, items };
      const msg = validate(doc); if (msg) return UI.toast(msg);
      const short = shortages(doc, 1);
      if (short.length && !(await shortDialog(short, "conduct"))) return;
      const pids = [...new Set(items.map(i => i.product))], before = Object.fromEntries(pids.map(p => [p, stockOf(p)]));
      if (!(await save())) return;
      const me = Data.me().key, at = Date.now();
      d.status = "done"; d.doneBy = me; d.doneAt = at;
      await Data.update(COL, id, { status: "done", doneBy: me, doneAt: at });
      invalidate(); draw();
      UI.toast(`✅ ${d.number} conducted: stock updated`);
      lowAlerts(pids, before);
    }
    async function unconduct() {
      const short = shortages(d, -1);
      if (short.length) { if (!(await shortDialog(short, "cancel"))) return; }
      else if (!(await UI.confirm("Cancel conduct? Stock goes back to how it was before this document, and the document becomes a draft you can edit.", "Cancel conduct"))) return;
      const pids = [...new Set(cleanItems().map(i => i.product))], before = Object.fromEntries(pids.map(p => [p, stockOf(p)]));
      d.status = "draft"; d.doneBy = null; d.doneAt = null;
      await Data.update(COL, id, { status: "draft", doneBy: null, doneAt: null });
      invalidate(); draw();
      UI.toast(`↩️ ${d.number} is a draft again`);
      lowAlerts(pids, before);
    }
    async function del() {
      if (!id) { closing = true; dirty = false; return pnl.close(); }
      if (!(await UI.confirm(`Delete draft ${d.number}?`, "Delete"))) return;
      const rec = clone(Data.get(COL, id)); delete rec.id;
      closing = true; dirty = false;
      const rid = id;
      await Data.remove(COL, rid);
      pnl.close();
      UI.toast(`🗑️ ${d.number} deleted`, { label: "Undo", run: () => Data.add(COL, rec, rid) });
    }

    const field = (label, ctl, cls) => h("div", { class: "inv-f" + (cls ? " " + cls : "") }, h("span", { text: label }), ctl);
    const itemsBox = h("div", { class: "inv-items" });

    function draw() {
      const ro = d.status === "done", whs = warehouses();
      const whSelect = (key, label) => {
        const sel = h("select", { class: "menu-input", disabled: ro }, h("option", { value: "" }, whs.length ? "Choose…" : "No warehouses yet"),
          ...whs.map(w => h("option", { value: w.id, selected: d[key] === w.id }, w.name || "Untitled warehouse")));
        if (d[key] && !whs.some(w => w.id === d[key])) sel.append(h("option", { value: d[key], selected: true }, whName(d[key])));
        sel.onchange = () => { d[key] = sel.value; dirty = true; drawItems(); };
        return field(label, sel);
      };
      const numIn = h("input", { class: "menu-input", value: d.number || "", disabled: ro, oninput: e => { d.number = e.target.value; dirty = true; } });
      const dateIn = h("input", { class: "menu-input", type: "date", value: d.date || "", disabled: ro, onchange: e => { d.date = e.target.value; dirty = true; } });
      const fields = [field("Number", numIn), field("Date", dateIn), whSelect("warehouse", type === "transfer" ? "From warehouse" : "Warehouse")];
      if (type === "transfer") fields.push(whSelect("to", "To warehouse"));
      if (type === "receipt") {
        const b = h("button", { class: "menu-input inv-pickbtn", type: "button", disabled: ro, onclick: e => pickVendor(e.currentTarget, v => { d.vendor = v; dirty = true; draw(); }) },
          h("span", { text: compName(d.vendor) ? "🏢 " + compName(d.vendor) : "Choose a vendor…" }));
        fields.push(field("Vendor", b));
      }
      if (type === "sale") {
        const b = h("button", { class: "menu-input inv-pickbtn", type: "button", disabled: ro, onclick: e => pickDeal(e.currentTarget, v => chooseDeal(v)) },
          h("span", { text: dealName(d.deal) ? "💼 " + dealName(d.deal) : "Link a CRM deal (optional)…" }));
        const open = d.deal && Data.get("deals", d.deal) && Apps.CRM?.openRecord ? h("button", { class: "icon-btn xs inv-open", type: "button", title: "Open deal", text: "↗", onclick: () => Apps.CRM.openRecord("deals", d.deal) }) : null;
        fields.push(field("Deal", h("div", { class: "inv-pickrow" }, b, open)));
      }
      if (type === "writeoff") {
        const sel = h("select", { class: "menu-input", disabled: ro, onchange: e => { d.reason = e.target.value; dirty = true; } }, ...REASONS.map(([k, l]) => h("option", { value: k, selected: (d.reason || "other") === k }, l)));
        fields.push(field("Reason", sel));
      }
      const note = h("textarea", { class: "menu-input f-ta", rows: 2, placeholder: "Anything worth knowing about this document", disabled: ro, oninput: e => { d.note = e.target.value; dirty = true; } });
      note.value = d.note || "";
      const by = d.by ? Data.person(d.by) : Data.me();
      const meta = [`Created by ${by.name}` + (d.at ? " · " + UI.timeAgo(d.at) : "")];
      if (ro && d.doneBy) meta.push(`conducted by ${Data.person(d.doneBy).name}` + (d.doneAt ? " · " + UI.timeAgo(d.doneAt) : ""));
      const foot = ro
        ? [h("button", { class: "btn", text: "↩️ Cancel conduct", onclick: unconduct }), h("span", { class: "grow" }), h("button", { class: "btn", text: "🖨️ Print", onclick: () => printDoc(snapshot()) })]
        : [id ? h("button", { class: "btn danger", text: "Delete", onclick: del }) : h("button", { class: "btn", text: "Discard", onclick: () => { closing = true; dirty = false; pnl.close(); } }),
          h("span", { class: "grow" }),
          h("button", { class: "btn", text: "Save draft", onclick: async () => { if (await save()) { UI.toast(`💾 ${d.number} saved`); draw(); } } }),
          h("button", { class: "btn primary", text: "✓ Conduct", title: "Apply this document to stock", onclick: conduct })];
      body.replaceChildren(
        h("div", { class: "inv-doc-head" }, h("div", { class: "peek-title", text: `${T.icon} ${d.number || T.label}` }), statusChip(d)),
        h("div", { class: "inv-doc-meta", text: id ? meta.join(", ") : "New " + T.label.toLowerCase() + ": not saved yet" }),
        ro ? h("div", { class: "inv-banner ok" }, "✅ Conducted: this document changed the stock. Cancel conduct to edit it.") : null,
        !ro && !whs.length ? h("div", { class: "inv-banner warn" }, "🏬 Add a warehouse first (Warehouses tab), then come back to conduct this document.") : null,
        h("div", { class: "inv-fields" }, ...fields),
        h("div", { class: "td-sec", text: "Products" }), itemsBox,
        field("Note", note, "wide"),
        h("div", { class: "inv-doc-foot" }, ...foot));
      drawItems();
    }

    async function chooseDeal(v) {
      d.deal = v; dirty = true; draw();
      const deal = v && Data.get("deals", v), lines = (deal && deal.products) || [];
      if (!lines.length) return;
      if (!(await UI.confirm(`Add the ${lines.length} product line${lines.length > 1 ? "s" : ""} from “${deal.title || "this deal"}” to this order?`, "Add products"))) return;
      let skipped = 0;
      lines.forEach(l => {
        let p = l.product && prod(l.product);
        if (!p && l.name) p = products().find(x => String(x.name || "").toLowerCase() === String(l.name).toLowerCase());
        if (!p) { skipped++; return; }
        const ex = d.items.find(it => it.product === p.id), q = num(l.qty) || 1, pr = l.price != null ? num(l.price) * (1 - num(l.discount) / 100) : num(p.price);
        if (ex) ex.qty = num(ex.qty) + q; else d.items.push({ product: p.id, qty: q, price: Math.round(pr * 100) / 100 });
      });
      dirty = true; draw();
      if (skipped) UI.toast(`${skipped} line${skipped > 1 ? "s aren't" : " isn't"} a catalog product and ${skipped > 1 ? "were" : "was"} skipped`);
    }

    function drawItems() {
      const ro = d.status === "done", outgoing = type !== "receipt";
      const totalEl = h("b", { class: "num" });
      const paintTotal = () => { totalEl.textContent = price(d.items.reduce((a, it) => a + num(it.qty) * num(it.price), 0)); };
      const rows = d.items.map((it, i) => {
        const p = prod(it.product), unit = p?.unit || "pcs";
        const avail = d.warehouse && it.product ? stockOf(it.product, d.warehouse) : null;
        const lt = h("span", { class: "inv-it-total num", "data-label": "Total", text: price(num(it.qty) * num(it.price)) });
        const hint = h("small", { class: "inv-it-hint" });
        const row = h("div", { class: "inv-it" });
        const check = () => {
          const short = outgoing && !ro && avail != null && num(it.qty) > avail;
          row.classList.toggle("short", short);
          hint.textContent = [p?.sku, outgoing && avail != null ? `${fq(avail)} ${unit} at ${whName(d.warehouse)}` : ""].filter(Boolean).join(" · ") + (short ? " · not enough" : "");
        };
        const qty = h("input", { class: "menu-input num", type: "number", min: "0", step: "any", value: it.qty ?? "", disabled: ro, "aria-label": "Quantity",
          oninput: e => { it.qty = e.target.value === "" ? "" : +e.target.value; dirty = true; lt.textContent = price(num(it.qty) * num(it.price)); paintTotal(); check(); } });
        const pr = h("input", { class: "menu-input num", type: "number", min: "0", step: "any", value: it.price ?? "", disabled: ro, "aria-label": T.price,
          oninput: e => { it.price = e.target.value === "" ? "" : +e.target.value; dirty = true; lt.textContent = price(num(it.qty) * num(it.price)); paintTotal(); } });
        const pb = h("button", { class: "inv-it-prod", type: "button", disabled: ro, title: ro ? "" : "Change product",
          onclick: e => pickProduct(e.currentTarget, np => { it.product = np.id; it.price = defaultPrice(np, type); dirty = true; drawItems(); }, d.warehouse) },
          h("b", { text: p ? p.name || "Untitled" : (it.product ? "Deleted product" : "Choose product…") }), hint);
        row.append(pb,
          h("label", { class: "inv-it-q", "data-label": "Qty" }, qty, h("small", { text: unit })),
          h("label", { class: "inv-it-p", "data-label": T.price }, pr), lt,
          ro ? h("span") : h("button", { class: "icon-btn xs inv-it-x", type: "button", title: "Remove line", html: UI.icon("x"), onclick: () => { d.items.splice(i, 1); dirty = true; drawItems(); } }));
        check();
        return row;
      });
      paintTotal();
      const add = ro ? null : h("button", { class: "btn inv-add-line", type: "button", text: "+ Add product", onclick: e => pickProduct(e.currentTarget, p => {
        const ex = d.items.find(it => it.product === p.id);
        if (ex) ex.qty = num(ex.qty) + 1; else d.items.push({ product: p.id, qty: 1, price: defaultPrice(p, type) });
        dirty = true; drawItems();
      }, d.warehouse) });
      itemsBox.replaceChildren(
        rows.length ? h("div", { class: "inv-it inv-it-head" }, h("span", { text: "Product" }), h("span", { text: "Qty" }), h("span", { text: T.price }), h("span", { class: "num", text: "Total" }), h("span")) : null,
        ...rows,
        !rows.length ? h("div", { class: "inv-items-empty", text: ro ? "No products." : "No products yet. Add what's " + (type === "receipt" ? "arriving." : type === "transfer" ? "moving." : type === "sale" ? "being sold." : "being written off.") }) : null,
        h("div", { class: "inv-items-foot" }, add, h("span", { class: "grow" }), h("span", { class: "inv-items-sum" }, `${d.items.filter(it => it.product).length} item${d.items.length === 1 ? "" : "s"} · Total `, totalEl)));
    }

    draw();
    return pnl;
  }

  /* ---------- printable document ---------- */
  function printDoc(d) {
    const T = TYPES[d.type] || TYPES.receipt, co = Data.get("settings", "company") || {};
    const logo = co.logo && co.logo.id ? (Data.get("files", co.logo.id) || {}).data : "";
    const items = (d.items || []).filter(it => it.product);
    const party = d.type === "receipt" ? ["Vendor", compName(d.vendor) || "—"] : d.type === "sale" ? ["Deal", dealName(d.deal) || "—"] : d.type === "writeoff" ? ["Reason", reasonLabel(d.reason)] : ["To warehouse", whName(d.to)];
    const rows = items.map((it, i) => { const p = prod(it.product) || {}; return `<tr><td>${i + 1}</td><td>${esc(p.name || "Deleted product")}</td><td>${esc(p.sku || "")}</td><td class="r">${esc(fq(it.qty))} ${esc(p.unit || "pcs")}</td><td class="r">${esc(price(it.price))}</td><td class="r">${esc(price(num(it.qty) * num(it.price)))}</td></tr>`; }).join("");
    const coLines = [co.address, [co.phone, co.email].filter(Boolean).join(" · "), co.website, co.taxId ? "Tax ID " + co.taxId : ""].filter(Boolean).map(l => `<div>${esc(l)}</div>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(T.print + " " + (d.number || ""))}</title><style>
      *{box-sizing:border-box} body{font:13.5px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2130;margin:44px;background:#fff}
      header{display:flex;justify-content:space-between;gap:30px;align-items:flex-start;border-bottom:2px solid #1d2130;padding-bottom:18px;margin-bottom:22px}
      h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em} .no{color:#555} .draft{color:#c2410c;font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.06em}
      .co{text-align:right;color:#444;font-size:12.5px} .co b{font-size:15px;color:#1d2130} .co img{max-height:54px;max-width:180px;margin-bottom:6px}
      .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 24px;margin-bottom:22px} .meta div span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#777}
      table{width:100%;border-collapse:collapse} th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;text-align:left;border-bottom:1px solid #bbb;padding:8px 6px}
      td{padding:8px 6px;border-bottom:1px solid #e5e5e5;vertical-align:top} .r{text-align:right;white-space:nowrap} tfoot td{border:0;font-weight:700;font-size:15px;padding-top:12px}
      .empty{text-align:center;color:#888;padding:24px} .note{margin-top:22px;padding:12px 14px;background:#f5f5f7;border-radius:8px;white-space:pre-wrap}
      .sign{display:flex;gap:60px;margin-top:70px} .sign div{flex:1;color:#555;font-size:12px} .sign span{display:block;border-bottom:1px solid #888;height:34px;margin-bottom:6px}
      @media print{body{margin:14mm} @page{margin:0}}
    </style></head><body>
      <header><div><h1>${esc(T.print)}</h1><div class="no">No. ${esc(d.number || "—")} · ${esc(longDate(d.date))}${d.status !== "done" ? ` · <span class="draft">Draft</span>` : ""}</div></div>
      <div class="co">${logo ? `<img src="${esc(logo)}" alt=""><br>` : ""}${co.name ? `<b>${esc(co.name)}</b>` : ""}${coLines}</div></header>
      <div class="meta"><div><span>${d.type === "transfer" ? "From warehouse" : "Warehouse"}</span>${esc(whName(d.warehouse))}</div><div><span>${esc(party[0])}</span>${esc(party[1])}</div><div><span>Responsible</span>${esc(Data.person(d.by || Data.me().key).name)}</div></div>
      <table><thead><tr><th>#</th><th>Product</th><th>SKU</th><th class="r">Qty</th><th class="r">${esc(T.price)}</th><th class="r">Total</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">No products</td></tr>`}</tbody>
      <tfoot><tr><td colspan="5" class="r">Total</td><td class="r">${esc(price(docTotal(d)))}</td></tr></tfoot></table>
      ${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}
      <div class="sign"><div><span></span>${esc(T.sign[0])}</div><div><span></span>${esc(T.sign[1])}</div></div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return UI.toast("Allow pop-ups for Lumen to print documents");
    w.document.open(); w.document.write(html); w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 350);
  }

  /* ---------- warehouses ---------- */
  async function editWarehouse(w) {
    const isNew = !w;
    const v = await Apps.form(isNew ? "New warehouse" : "Edit warehouse", [{ key: "name", label: "Name", required: true, placeholder: "Main warehouse" }, { key: "address", label: "Address", type: "textarea", rows: 2 }, { key: "default", label: "Default warehouse for new documents", type: "checkbox" }],
      isNew ? { default: !warehouses().length } : { name: w.name, address: w.address || "", default: !!w.default }, { ok: isNew ? "Create" : "Save", width: 460 });
    if (!v) return null;
    const data = { name: v.name.trim(), address: (v.address || "").trim(), default: !!v.default || !warehouses().some(x => x.id !== w?.id) };
    let id = w?.id;
    if (isNew) id = await Data.add(COL, { kind: "warehouse", ...data }); else Data.update(COL, id, data);
    if (data.default) warehouses().forEach(x => { if (x.id !== id && x.default) Data.update(COL, x.id, { default: false }); });
    return id;
  }
  function setDefault(w) { warehouses().forEach(x => { if (x.default && x.id !== w.id) Data.update(COL, x.id, { default: false }); }); Data.update(COL, w.id, { default: true }); UI.toast(`⭐ ${w.name} is the default warehouse`); }
  async function deleteWarehouse(w) {
    const used = docs().filter(d => d.warehouse === w.id || d.to === w.id).length;
    const st = compute().stock, held = Object.keys(st).filter(pid => Math.abs(st[pid][w.id] || 0) > 1e-9).length;
    const ok = await UI.confirm(used || held
      ? `“${w.name}” is not empty: ${held} product${held === 1 ? "" : "s"} in stock and ${used} document${used === 1 ? "" : "s"}. Delete it anyway? Documents keep its name, and its stock still counts in totals until you move or write it off.`
      : `Delete warehouse “${w.name}”?`, "Delete");
    if (!ok) return;
    if (used || held) await Data.update(COL, w.id, { deleted: true, default: false }); else await Data.remove(COL, w.id);
    if (w.default) { const next = warehouses()[0]; if (next) Data.update(COL, next.id, { default: true }); }
    UI.toast(`🗑️ ${w.name} deleted`);
  }

  /* ---------- sample data ---------- */
  async function addSample() {
    const wh = await Data.add(COL, { kind: "warehouse", name: "Main warehouse", address: "", default: !warehouses().length });
    const items = [["Wireless mouse", "WM-100", 25, 5, 40, 14], ["USB-C cable 1 m", "CB-200", 9, 20, 120, 3], ["Laptop stand", "LS-300", 49, 5, 4, 28]];
    const lines = [];
    for (const [name, sku, pr, minStock, qty, cost] of items) {
      const id = await Data.add("products", { name, sku, kind: "product", price: pr, unit: "pcs", tax: 0, category: "Sample", desc: "", active: true, track: true, minStock });
      lines.push({ product: id, qty, price: cost });
    }
    await Data.add(COL, { kind: "doc", type: "receipt", number: nextNumber("receipt"), date: Apps.today(), warehouse: wh, to: "", vendor: "", deal: "", reason: "", items: lines, status: "done", note: "Sample stock to try Inventory", doneBy: Data.me().key, doneAt: Date.now() });
    invalidate(); paintBadge();
    UI.toast("✨ Sample data added: 1 warehouse, 3 products, 1 receipt");
  }

  /* ---------- product stock panel ---------- */
  function openProduct(pid) {
    if (!prod(pid)) return UI.toast("That product is no longer available");
    const body = h("div", { class: "inv-prod" });
    const pnl = Apps.panel("Product stock", body, [h("button", { class: "btn", text: "Edit product", onclick: () => editProduct(prod(pid)) })]);
    function draw() {
      const p = prod(pid); if (!p) return pnl.close();
      const c = compute(), s = c.stock[pid] || {}, total = stockOf(pid), unit = p.unit || "pcs";
      const whs = [...warehouses(), ...allWh().filter(w => w.deleted && Math.abs(s[w.id] || 0) > 1e-9)];
      const max = Math.max(1, ...whs.map(w => Math.abs(s[w.id] || 0)));
      const mv = c.moves[pid] || [];
      let bal = 0;
      const hist = mv.map(m => { bal += m.net; return { ...m, bal }; }).reverse().slice(0, 150);
      body.replaceChildren(
        h("div", { class: "peek-title", text: p.name || "Untitled product" }),
        h("div", { class: "inv-prod-sub" }, levelChip(p), h("span", { text: [p.sku ? "SKU " + p.sku : "", unit, price(p.price)].filter(Boolean).join(" · ") })),
        h("div", { class: "inv-mini-kpis" },
          h("div", { class: "kpi glass" }, h("span", { text: "In stock" }), h("b", { text: fq(total) }), h("small", { text: unit })),
          h("div", { class: "kpi glass" }, h("span", { text: "Value" }), h("b", { text: money(total * num(p.price)) }), h("small", { text: "at sale price" })),
          h("button", { class: "kpi glass inv-kpi-btn", title: "Change stock settings", onclick: () => stockSettings(p) }, h("span", { text: "Minimum" }), h("b", { text: num(p.minStock) ? fq(p.minStock) : "—" }), h("small", { text: p.track === false ? "not tracked · edit" : "edit" }))),
        h("div", { class: "inv-quick" },
          h("button", { class: "btn", text: "📥 Receive", onclick: () => openDoc(null, "receipt", { items: [{ product: pid, qty: 1, price: costOf(pid) }] }) }),
          h("button", { class: "btn", text: "📤 Sell", onclick: () => openDoc(null, "sale", { items: [{ product: pid, qty: 1, price: num(p.price) }] }) }),
          warehouses().length > 1 ? h("button", { class: "btn", text: "🔁 Move", onclick: () => openDoc(null, "transfer", { items: [{ product: pid, qty: 1, price: costOf(pid) }] }) }) : null,
          h("button", { class: "btn", text: "🗑️ Write off", onclick: () => openDoc(null, "writeoff", { items: [{ product: pid, qty: 1, price: costOf(pid) }] }) })),
        h("div", { class: "td-sec", text: "Stock by warehouse" }),
        whs.length ? h("div", { class: "inv-whbars" }, ...whs.map((w, i) => {
          const q = s[w.id] || 0;
          return h("div", { class: "inv-hb-row" }, h("span", { class: "inv-hb-l", text: whName(w.id) }),
            h("div", { class: "inv-hb" }, h("span", { class: q < 0 ? "neg" : "", style: { width: Math.abs(q) / max * 100 + "%", animationDelay: i * 50 + "ms" } })),
            h("b", { class: "num" + (q < 0 ? " inv-neg" : ""), text: fq(q) }));
        })) : h("div", { class: "inv-muted", text: "No warehouses yet." }),
        h("div", { class: "td-sec", text: "Movement history" }),
        hist.length ? h("div", { class: "inv-hist" },
          h("div", { class: "inv-hist-row head" }, h("span", { text: "Date" }), h("span", { text: "Document" }), h("span", { text: "Warehouse" }), h("span", { class: "num", text: "Change" }), h("span", { class: "num", text: "Balance" })),
          ...hist.map(m => { const d = m.doc, T = TYPES[d.type];
            return h("button", { class: "inv-hist-row", type: "button", onclick: () => openDoc(d.id) },
              h("span", { class: "inv-muted", text: Apps.fmtDate(docDate(d)) }),
              h("span", { class: "inv-hist-doc" }, h("span", { text: T.icon }), h("b", { text: d.number || T.label })),
              h("span", { class: "inv-ellip", text: d.type === "transfer" ? `${whName(d.warehouse)} → ${whName(d.to)}` : whName(d.warehouse) }),
              h("span", { class: "num inv-delta " + (m.net > 0 ? "up" : m.net < 0 ? "down" : "move"), text: m.net > 0 ? "+" + fq(m.qty) : m.net < 0 ? "−" + fq(m.qty) : "↔ " + fq(m.qty) }),
              h("b", { class: "num", text: fq(m.bal) }));
          })) : h("div", { class: "inv-muted", text: "No conducted documents with this product yet." }));
    }
    const redraw = UI.liveDraw(body, () => { invalidate(); draw(); });
    const offs = [Data.on(COL, redraw), Data.on("products", redraw)];
    pnl.onClose = () => offs.forEach(f => f());
    return pnl;
  }

  /* ---------- tables that turn into cards on phones ---------- */
  function table(cols, rows, opts = {}) {
    const tpl = cols.map(c => c.w || "1fr").join(" "), minW = opts.minWidth || 0;
    const cell = (v, c) => h("span", { class: "inv-td" + (c.num ? " num" : "") + (c.main ? " main" : "") + (c.cls ? " " + c.cls : ""), "data-label": c.label }, v instanceof Node ? v : String(v ?? ""));
    return h("div", { class: "inv-table-wrap" }, h("div", { class: "inv-table", style: minW ? { minWidth: minW + "px" } : null },
      h("div", { class: "inv-tr inv-th", style: { gridTemplateColumns: tpl } }, ...cols.map(c => h("span", { class: c.num ? "num" : "", text: c.label }))),
      ...rows.map((r, i) => h("div", { class: "inv-tr" + (r.cls ? " " + r.cls : ""), style: { gridTemplateColumns: tpl, animationDelay: Math.min(i, 14) * 22 + "ms" }, onclick: r.onClick || null, role: r.onClick ? "button" : null, tabindex: r.onClick ? 0 : null,
        onkeydown: r.onClick ? e => { if (e.key === "Enter") r.onClick(); } : null }, ...r.cells.map((v, j) => cell(v, cols[j])))),
      opts.foot ? h("div", { class: "inv-tfoot" }, opts.foot) : null));
  }
  const who = key => h("span", { class: "who" }, Apps.avatar(Data.person(key), 20), h("span", { text: (Data.person(key).name || "").split(" ")[0] }));
  const kpi = (label, value, sub, i, onclick, on) => h(onclick ? "button" : "div", { class: "kpi glass inv-kpi" + (onclick ? " inv-kpi-btn" : "") + (on ? " on" : ""), style: { animationDelay: i * 60 + "ms" }, onclick: onclick || null },
    h("span", { text: label }), h("b", { text: value }), h("small", { text: sub }));
  const inPeriod = (d, per) => {
    const dt = docDate(d), t = Apps.today();
    if (per === "month") return dt.slice(0, 7) === t.slice(0, 7);
    if (per === "30") return dt >= Apps.addDays(t, -29) && dt <= t;
    if (per === "year") return dt.slice(0, 4) === t.slice(0, 4);
    return true;
  };

  /* ---------- main view ---------- */
  function render(root, arg) {
    startWatch();
    const valid = k => TABS.some(t => t[0] === k);
    let openId = "";
    if (arg && arg.startsWith("doc:")) { openId = arg.slice(4); const d = Data.get(COL, openId); arg = d && TYPES[d.type] ? TYPES[d.type].tab : ""; }
    let saved = ""; try { saved = localStorage.getItem(TAB_KEY) || ""; } catch {}
    let tab = valid(arg) ? arg : valid(saved) ? saved : "stock";
    const st = { q: "", wh: "", low: false, status: "all", period: "all" };
    const head = Apps.header("Inventory", "📦", "Warehouses, stock and documents");
    const acts = head.querySelector(".app-actions");
    const toolbar = h("div", { class: "app-toolbar inv-toolbar" }), body = h("div", { class: "inv-body" });
    const setTab = k => {
      tab = k; st.q = ""; st.status = "all";
      try { localStorage.setItem(TAB_KEY, k); } catch {}
      try { history.replaceState(null, "", "#/app/inventory/" + k); } catch {}
      tabsEl.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", TABS[i][0] === k));
      drawAll();
    };
    const tabsEl = Apps.tabs(TABS, tab, setTab);
    root.append(head, tabsEl, toolbar, body);

    function drawActs() {
      const type = TAB_TYPE[tab];
      acts.replaceChildren(...(
        tab === "stock" ? [h("button", { class: "btn", text: "+ Product", onclick: () => newProduct().then(id => id && prod(id) && openProduct(id)) }), h("button", { class: "btn primary", text: "📥 Receive stock", onclick: () => openDoc(null, "receipt") })]
        : type ? [h("button", { class: "btn primary", text: "+ Create", title: "New " + TYPES[type].label.toLowerCase(), onclick: () => openDoc(null, type) })]
        : tab === "warehouses" ? [h("button", { class: "btn primary", text: "+ Warehouse", onclick: () => editWarehouse() })]
        : []));
    }
    function whFilter() {
      if (st.wh && !warehouses().some(w => w.id === st.wh)) st.wh = "";
      return h("select", { class: "app-select", title: "Warehouse", onchange: e => { st.wh = e.target.value; drawBody(); } },
        h("option", { value: "" }, "All warehouses"), ...warehouses().map(w => h("option", { value: w.id, selected: st.wh === w.id }, w.name || "Untitled")));
    }
    function drawToolbar() {
      const type = TAB_TYPE[tab];
      if (tab !== "stock" && !type) { toolbar.replaceChildren(); toolbar.style.display = "none"; return; }
      toolbar.style.display = "";
      const search = h("input", { class: "app-search", type: "search", placeholder: tab === "stock" ? "Search products or SKU…" : "Search number, product, note…", value: st.q, oninput: e => { st.q = e.target.value.trim().toLowerCase(); drawBody(); } });
      if (tab === "stock") {
        const low = h("button", { class: "chip-btn inv-toggle" + (st.low ? " on" : ""), type: "button", onclick: () => { st.low = !st.low; drawToolbar(); drawBody(); } }, h("span", { class: "switch" + (st.low ? " on" : "") }), "Low stock only");
        toolbar.replaceChildren(search, whFilter(), low);
      } else {
        const seg = h("div", { class: "seg inv-seg" }, ...[["all", "All"], ["draft", "Drafts"], ["done", "Conducted"]].map(([k, l]) =>
          h("button", { class: st.status === k ? "on" : "", type: "button", text: l, onclick: () => { st.status = k; drawToolbar(); drawBody(); } })));
        const per = h("select", { class: "app-select", title: "Period", onchange: e => { st.period = e.target.value; drawBody(); } },
          ...[["all", "All time"], ["month", "This month"], ["30", "Last 30 days"], ["year", "This year"]].map(([k, l]) => h("option", { value: k, selected: st.period === k }, l)));
        toolbar.replaceChildren(search, seg, whFilter(), per);
      }
    }
    function drawBody() {
      const type = TAB_TYPE[tab];
      const view = tab === "stock" ? stockView() : type ? docList(type) : tab === "warehouses" ? whView() : analytics();
      view.classList.add("inv-view");
      body.replaceChildren(view);
    }
    function drawAll() { drawActs(); drawToolbar(); drawBody(); }

    /* setup guide shown until there's stock */
    function guide() {
      const hasWh = warehouses().length > 0, hasP = tracked().length > 0, hasRec = compute().done.some(d => d.type === "receipt");
      const empty = !allWh().length && !docs().length;
      const step = (n, done, title, text, btn) => h("div", { class: "inv-step" + (done ? " done" : "") }, h("span", { class: "inv-step-n", text: done ? "✓" : n }),
        h("div", { class: "inv-step-t" }, h("b", { text: title }), h("small", { text })), done ? null : btn);
      return h("div", { class: "inv-guide glass" },
        h("div", { class: "inv-guide-h" }, h("span", { class: "inv-guide-ic", text: "📦" }), h("div", null, h("h3", { text: "Set up your inventory" }), h("small", { text: "Three steps and you'll see live stock levels here." }))),
        step(1, hasWh, "Add a warehouse", "Where your goods are kept: a store, a stockroom, a van.", h("button", { class: "btn", text: "+ Warehouse", onclick: () => editWarehouse() })),
        step(2, hasP, "Add products", "Name, SKU, price and unit. Stock is counted for tracked products.", h("button", { class: "btn", text: "+ Product", onclick: () => newProduct() })),
        step(3, hasRec, "Receive stock", "Create a receipt and conduct it: that's what puts goods on the shelf.", h("button", { class: "btn primary", text: "📥 New receipt", onclick: () => openDoc(null, "receipt") })),
        empty ? h("div", { class: "inv-guide-foot" }, h("span", { text: "Just looking around?" }), h("button", { class: "btn", text: "✨ Add sample data", onclick: e => { e.currentTarget.disabled = true; addSample(); } })) : null);
    }

    function stockView() {
      const c = compute(), all = tracked();
      const needGuide = !warehouses().length || !all.length || !c.done.length;
      const lowN = all.filter(p => levelOf(p) === "low").length, outN = all.filter(p => levelOf(p) === "out").length;
      const kpis = h("div", { class: "inv-kpis" },
        kpi("Stock value", money(valueOf(st.wh || undefined)), st.wh ? whName(st.wh) : "all warehouses", 0),
        kpi("Products tracked", String(all.length), warehouses().length + " warehouse" + (warehouses().length === 1 ? "" : "s"), 1),
        kpi("Low stock", String(lowN), "at or below minimum", 2, () => { st.low = !st.low; drawToolbar(); drawBody(); }, st.low),
        kpi("Out of stock", String(outN), "need restocking", 3, () => { st.low = !st.low; drawToolbar(); drawBody(); }, st.low));
      if (!all.length) return h("div", null, needGuide ? guide() : null);
      const usedWh = new Set(); Object.values(c.stock).forEach(s => Object.keys(s).forEach(w => { if (Math.abs(s[w]) > 1e-9) usedWh.add(w); }));
      let cols = [...warehouses(), ...allWh().filter(w => w.deleted && usedWh.has(w.id))];
      if (st.wh) cols = cols.filter(w => w.id === st.wh);
      const list = all.filter(p => {
        if (st.q && !`${p.name || ""} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(st.q)) return false;
        if (st.low && levelOf(p) === "ok") return false;
        if (st.wh && !p.track && !(c.moves[p.id] || []).some(m => m.doc.warehouse === st.wh || m.doc.to === st.wh)) return false;
        return true;
      }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      const tcols = [{ label: "Product", w: "minmax(150px,1.8fr)", main: true }, { label: "SKU", w: ".8fr" }, { label: "Unit", w: ".5fr" },
        ...cols.map(w => ({ label: w.name || "Warehouse", w: ".75fr", num: true })),
        ...(st.wh ? [] : [{ label: "Total", w: ".7fr", num: true }]), { label: "Value", w: ".85fr", num: true }, { label: "Status", w: "minmax(96px,.9fr)" }];
      const rows = list.map(p => {
        const q = st.wh ? stockOf(p.id, st.wh) : stockOf(p.id);
        return { cls: "lvl-" + levelOf(p), onClick: () => openProduct(p.id), cells: [
          h("span", { class: "inv-pname" }, h("b", { text: p.name || "Untitled" }), p.track ? null : h("small", { text: "not tracked" })),
          p.sku || "—", p.unit || "pcs",
          ...cols.map(w => { const v = stockOf(p.id, w.id); return h("span", { class: v < 0 ? "inv-neg" : v === 0 ? "inv-zero" : "", text: fq(v) }); }),
          ...(st.wh ? [] : [h("b", { class: q < 0 ? "inv-neg" : "", text: fq(q) })]),
          money(q * num(p.price)), levelChip(p)] };
      });
      const totalV = list.reduce((a, p) => a + (st.wh ? stockOf(p.id, st.wh) : stockOf(p.id)) * num(p.price), 0);
      return h("div", null, needGuide ? guide() : null, kpis,
        rows.length ? table(tcols, rows, { minWidth: 560 + cols.length * 90, foot: h("span", null, `${rows.length} product${rows.length === 1 ? "" : "s"} · value `, h("b", { text: money(totalV) })) })
          : Apps.empty("🔎", st.low ? "Nothing is low on stock. Nice!" : "No products match."));
    }

    function docList(type) {
      const T = TYPES[type];
      const list = docs().filter(d => d.type === type)
        .filter(d => st.status === "all" || (st.status === "done" ? d.status === "done" : d.status !== "done"))
        .filter(d => !st.wh || d.warehouse === st.wh || d.to === st.wh)
        .filter(d => inPeriod(d, st.period))
        .filter(d => !st.q || `${d.number} ${d.note || ""} ${counterparty(d)} ${(d.items || []).map(it => pName(it.product)).join(" ")}`.toLowerCase().includes(st.q))
        .sort((a, b) => ord(b).localeCompare(ord(a)));
      if (!list.length) {
        const any = docs().some(d => d.type === type);
        return Apps.empty(T.icon, any ? "No " + T.plural + " match these filters." : "No " + T.plural + " yet.", any ? null : h("button", { class: "btn primary", text: "+ Create " + T.label.toLowerCase(), onclick: () => openDoc(null, type) }));
      }
      const cols = [{ label: "Number", w: "minmax(110px,1fr)", main: true }, { label: "Date", w: ".7fr" },
        { label: type === "transfer" ? "From → to" : "Warehouse", w: type === "transfer" ? "1.6fr" : "1.1fr" },
        ...(type === "transfer" ? [] : [{ label: type === "receipt" ? "Vendor" : type === "sale" ? "Deal" : "Reason", w: "1.1fr" }]),
        { label: "Items", w: ".5fr", num: true }, { label: "Total", w: ".85fr", num: true }, { label: "Status", w: "minmax(96px,.85fr)" }, { label: "Responsible", w: ".9fr" }];
      const rows = list.map(d => ({ cls: d.status === "done" ? "is-done" : "is-draft", onClick: () => openDoc(d.id), cells: [
        h("span", { class: "inv-docno" }, h("span", { text: T.icon }), h("b", { text: d.number || "—" })),
        Apps.fmtDate(docDate(d)),
        type === "transfer" ? `${whName(d.warehouse)} → ${whName(d.to)}` : whName(d.warehouse),
        ...(type === "transfer" ? [] : [counterparty(d) || "—"]),
        String((d.items || []).filter(it => it.product).length), price(docTotal(d)), statusChip(d), who(d.by)] }));
      const sum = list.reduce((a, d) => a + docTotal(d), 0);
      return table(cols, rows, { minWidth: 820, foot: h("span", null, `${list.length} document${list.length === 1 ? "" : "s"} · total `, h("b", { text: price(sum) })) });
    }

    function whView() {
      const whs = warehouses();
      if (!whs.length) return h("div", null, Apps.empty("🏬", "No warehouses yet. Add the places where you keep stock.", h("button", { class: "btn primary", text: "+ Warehouse", onclick: () => editWarehouse() })),
        !docs().length ? h("div", { class: "inv-center" }, h("button", { class: "btn", text: "✨ Add sample data", onclick: e => { e.currentTarget.disabled = true; addSample(); } })) : null);
      const st0 = compute().stock;
      return h("div", { class: "inv-wh-grid" }, ...whs.map((w, i) => {
        const pids = Object.keys(st0).filter(pid => prod(pid) && (st0[pid][w.id] || 0) > 1e-9);
        const docsN = docs().filter(d => d.warehouse === w.id || d.to === w.id).length;
        return h("div", { class: "inv-wh glass" + (w.default ? " default" : ""), style: { animationDelay: i * 50 + "ms" } },
          h("div", { class: "inv-wh-top" }, h("span", { class: "inv-wh-ic", text: "🏬" }), h("div", { class: "inv-wh-name" }, h("b", { text: w.name || "Untitled warehouse" }), w.default ? chip("Default", "purple") : null),
            h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, [
              { label: "Edit", icon: "text", onClick: () => editWarehouse(w) },
              !w.default ? { label: "Set as default", icon: "star", onClick: () => setDefault(w) } : null,
              { label: "Show stock here", icon: "table", onClick: () => { st.wh = w.id; setTab("stock"); } },
              { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: () => deleteWarehouse(w) }], { align: "end" }) })),
          h("div", { class: "inv-wh-addr", text: w.address || "No address" }),
          h("div", { class: "inv-wh-stats" },
            h("div", null, h("b", { text: String(pids.length) }), h("small", { text: "products" })),
            h("div", null, h("b", { text: money(valueOf(w.id)) }), h("small", { text: "stock value" })),
            h("div", null, h("b", { text: String(docsN) }), h("small", { text: "documents" }))),
          h("div", { class: "inv-wh-acts" }, h("button", { class: "btn", text: "Edit", onclick: () => editWarehouse(w) }),
            !w.default ? h("button", { class: "btn", text: "Set default", onclick: () => setDefault(w) }) : null,
            h("button", { class: "btn danger", text: "Delete", onclick: () => deleteWarehouse(w) })));
      }));
    }

    function analytics() {
      const c = compute(), all = tracked(), total = valueOf(), T0 = Apps.today();
      if (!c.done.length) return h("div", null, Apps.empty("📊", "Analytics appear once you conduct your first document."), !warehouses().length || !all.length ? guide() : null);
      const hbars = (rows, color) => { const max = Math.max(1, ...rows.map(r => Math.abs(r[1]))); return h("div", { class: "inv-bars" }, ...rows.map(([label, v, txt, onclick], i) =>
        h(onclick ? "button" : "div", { class: "inv-hb-row", onclick: onclick || null, type: onclick ? "button" : null }, h("span", { class: "inv-hb-l", text: label, title: label }),
          h("div", { class: "inv-hb" }, h("span", { class: v < 0 ? "neg" : "", style: { width: Math.abs(v) / max * 100 + "%", background: color || null, animationDelay: i * 45 + "ms" } })),
          h("b", { class: "num", text: txt }))));
      };
      const card = (title, sub, content, cls) => h("div", { class: "inv-card glass" + (cls ? " " + cls : "") }, h("div", { class: "inv-card-h" }, h("h3", { text: title }), sub ? h("small", { text: sub }) : null), content);
      const usedWh = new Set(); Object.values(c.stock).forEach(s => Object.keys(s).forEach(w => { if (Math.abs(s[w]) > 1e-9) usedWh.add(w); }));
      const whRows = [...warehouses(), ...allWh().filter(w => w.deleted && usedWh.has(w.id))].map(w => { const v = valueOf(w.id); return [whName(w.id), v, money(v)]; });
      const top = all.map(p => [p, stockOf(p.id) * num(p.price)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
      // receipts vs sales per week (calendar weeks touching the last 30 days)
      const from = Apps.addDays(T0, -29), dow = (new Date(from + "T00:00").getDay() + 6) % 7;
      const weeks = []; for (let ws = Apps.addDays(from, -dow); ws <= T0; ws = Apps.addDays(ws, 7)) weeks.push({ ws, we: Apps.addDays(ws, 6), rec: 0, sale: 0 });
      let recSum = 0, saleSum = 0;
      c.done.forEach(d => {
        const dt = docDate(d); if (dt < from || dt > T0 || (d.type !== "receipt" && d.type !== "sale")) return;
        const w = weeks.find(x => dt >= x.ws && dt <= x.we); if (!w) return;
        const v = docTotal(d); if (d.type === "receipt") { w.rec += v; recSum += v; } else { w.sale += v; saleSum += v; }
      });
      const vmax = Math.max(1, ...weeks.flatMap(w => [w.rec, w.sale]));
      const pct = v => v > 0 ? Math.max(2, v / vmax * 100) + "%" : "0";
      const vbars = h("div", { class: "inv-vchart" },
        h("div", { class: "inv-legend" }, h("span", null, h("i", { class: "rec" }), "Receipts · " + money(recSum)), h("span", null, h("i", { class: "sale" }), "Sales · " + money(saleSum))),
        h("div", { class: "inv-vbars" }, ...weeks.map((w, i) => h("div", { class: "inv-vb-grp" },
          h("div", { class: "inv-vb-bars" },
            h("span", { class: "inv-vb rec", style: { height: pct(w.rec), animationDelay: i * 70 + "ms" }, title: `Receipts, week of ${Apps.fmtDate(w.ws)}: ${money(w.rec)}` }),
            h("span", { class: "inv-vb sale", style: { height: pct(w.sale), animationDelay: i * 70 + 35 + "ms" }, title: `Sales, week of ${Apps.fmtDate(w.ws)}: ${money(w.sale)}` })),
          h("small", { text: Apps.fmtDate(w.ws) })))));
      const cutoff = Apps.addDays(T0, -60);
      const slow = all.filter(p => stockOf(p.id) > 0 && (!c.lastSale[p.id] || c.lastSale[p.id] < cutoff)).sort((a, b) => stockOf(b.id) * num(b.price) - stockOf(a.id) * num(a.price)).slice(0, 12);
      const units = all.reduce((a, p) => a + Math.max(0, stockOf(p.id)), 0);
      const month = c.done.filter(d => docDate(d).slice(0, 7) === T0.slice(0, 7)).length;
      return h("div", null,
        h("div", { class: "inv-kpis" }, kpi("Total stock value", money(total), "at sale prices", 0), kpi("Units in stock", fq(units), all.length + " products", 1),
          kpi("Low or out", String(lowList().length), "tracked products", 2, () => { st.low = true; setTab("stock"); }), kpi("Conducted this month", String(month), "documents", 3)),
        h("div", { class: "inv-charts" },
          card("Value by warehouse", money(total) + " in total", whRows.length ? hbars(whRows) : h("div", { class: "inv-muted", text: "No warehouses yet." })),
          card("Top 10 products by value", "", top.length ? hbars(top.map(([p, v]) => [p.name || "Untitled", v, money(v), () => openProduct(p.id)]), "var(--c-purple)") : h("div", { class: "inv-muted", text: "No stock on hand." })),
          card("Movements, last 30 days", "receipts vs sales per week, by value", vbars, "wide"),
          card("Slow movers", "in stock, no sales in 60 days", slow.length ? h("div", { class: "inv-slow" }, ...slow.map(p => h("button", { class: "inv-slow-row", type: "button", onclick: () => openProduct(p.id) },
            h("span", { class: "inv-pname" }, h("b", { text: p.name || "Untitled" }), h("small", { text: p.sku || "" })),
            h("span", { class: "num", text: fq(stockOf(p.id)) + " " + (p.unit || "pcs") }),
            h("span", { class: "num", text: money(stockOf(p.id) * num(p.price)) }),
            h("small", { class: "inv-muted", text: c.lastSale[p.id] ? "last sale " + Apps.fmtDate(c.lastSale[p.id]) : "never sold" })))) : h("div", { class: "inv-muted", text: "Everything in stock has sold recently. 🎉" }), "wide")));
    }

    drawAll();
    const redraw = UI.liveDraw(root, () => { invalidate(); drawToolbar(); drawBody(); });
    const offs = [COL, "products", "companies", "deals"].map(c => Data.on(c, redraw));
    if (openId) setTimeout(() => openDoc(openId), 60);
    return () => offs.forEach(f => f());
  }

  Apps.register("inventory", { title: "Inventory", icon: "📦", render });
  window.InventoryAPI = {
    stock: (productId, warehouseId) => stockOf(productId, warehouseId),
    value: () => valueOf(),
    low: () => lowList().map(p => p.id),
    open: id => openDoc(id),
  };
  Apps.Inventory = { openDoc, openProduct, newDoc: (type, preset) => openDoc(null, type, preset), print: id => { const d = Data.get(COL, id); if (d) printDoc(d); } };
})();
