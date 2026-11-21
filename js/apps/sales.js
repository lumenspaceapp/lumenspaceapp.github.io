/* Product catalog, estimates and invoices (used by the CRM app; registers no sidebar app).
   Apps.Sales = { render(root, tab), editProduct(product?), productPicker(anchor, onPick), openQuote(id), newQuote(opts),
                  dealProducts(container, deal), totals(items), settings() } */
(function () {
  const { h, esc } = UI;
  const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD", "CHF", "JPY", "CNY", "SAR", "ZAR", "BRL", "SEK", "PLN", "TRY"];
  const UNITS = ["pcs", "hour", "day", "week", "month", "year", "kg", "g", "l", "m", "m²", "box", "set", "pack", "license", "service"];
  const STATUS = {
    estimate: { draft: ["Draft", "gray"], sent: ["Sent", "blue"], accepted: ["Accepted", "green"], declined: ["Declined", "red"] },
    invoice: { draft: ["Draft", "gray"], sent: ["Sent", "blue"], overdue: ["Overdue", "red"], paid: ["Paid", "green"], cancelled: ["Cancelled", "brown"] },
  };
  const KIND = { estimate: { one: "estimate", One: "Estimate", icon: "📝" }, invoice: { one: "invoice", One: "Invoice", icon: "🧾" } };

  /* ---------- small helpers ---------- */
  const num = v => { if (typeof v === "number") return isFinite(v) ? v : 0; const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; };
  const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const clone = o => JSON.parse(JSON.stringify(o ?? null));
  const uniq = a => [...new Set(a.filter(Boolean))];
  const meKey = () => Data.me().key;
  const company = () => Data.get("settings", "company") || {};
  const defCur = () => company().currency || Apps.currency();
  const pad = x => String(x).padStart(4, "0");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
  const fmts = {};
  function fmt(v, cur, short) {
    cur = cur || defCur();
    const k = cur + (short ? ":s" : "");
    try {
      fmts[k] ||= new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: short ? 0 : 2, maximumFractionDigits: short ? 0 : 2 });
      return fmts[k].format(num(v));
    } catch { return num(v).toFixed(short ? 0 : 2) + " " + cur; }
  }
  const qtyFmt = x => { try { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(num(x)); } catch { return String(num(x)); } };
  const longDate = d => d ? new Date(d + (d.length === 10 ? "T00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const fileData = att => (att && att.id && Data.get("files", att.id)?.data) || "";
  const nameOf = (col, id) => { const r = id && Data.get(col, id); return r ? (r.name || r.title || "") : ""; };
  const live = col => Data.list(col).filter(x => !x.deleted);
  const who = key => { const p = Data.person(key); return h("span", { class: "who" }, Apps.avatar(p, 20), h("span", { class: "sl-ell", text: p.name })); };
  const tagEl = (text, c) => h("span", { class: "tag", dataset: { tc: c }, text });

  function seg(items, cur, onChange) {
    const el = h("div", { class: "seg" });
    items.forEach(([k, l, title]) => el.append(h("button", { type: "button", class: k === cur ? "on" : "", title: title || null, html: l,
      onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); onChange(k); } })));
    return el;
  }
  function select(opts, cur, onChange, cls = "app-select") {
    const el = h("select", { class: cls }, ...opts.map(([v, l]) => h("option", { value: v, text: l })));
    el.value = cur; el.onchange = () => onChange(el.value);
    return el;
  }
  function toggle(on, onChange) {
    const b = h("button", { type: "button", class: "switch" + (on ? " on" : ""), role: "switch", "aria-checked": String(!!on) });
    b.onclick = e => { e.stopPropagation(); on = !on; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); onChange(on); };
    return b;
  }
  const switchRow = (label, hint, on, onChange) => {
    const t = toggle(on, onChange);
    return h("div", { class: "sl-switch-row", onclick: e => { if (e.target !== t) t.click(); } }, h("div", null, h("b", { text: label }), hint ? h("small", { text: hint }) : null), t);
  };
  const field = (label, ctl, cls) => h("label", { class: "sl-f " + (cls || "") }, h("span", { text: label }), ctl);
  // one shared <datalist> per id, refreshed on every call
  function dl(id, values) {
    let el = document.getElementById(id);
    if (!el) { el = h("datalist", { id }); document.body.append(el); }
    el.replaceChildren(...uniq(values).map(v => h("option", { value: v })));
    return id;
  }
  function download(name, text, type) {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: u, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  // big photos are scaled down before upload so they fit the 700 KB attachment limit
  function shrinkImage(file, max = 640) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.resolve(file);
    return new Promise(res => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        if (k === 1 && file.size < 300 * 1024) return res(file);
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const png = file.type === "image/png", type = png ? "image/png" : "image/jpeg";
        c.toBlob(b => res(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, "") + (png ? ".png" : ".jpg"), { type }) : file), type, .86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  /* ---------- modal windows (stack above CRM sliders, and popovers stack above them) ---------- */
  const stack = [];
  function overlay(cls, opts = {}) {
    UI.closePops();
    const box = h("div", { class: "sl-modal glass-strong " + (cls || ""), role: "dialog" });
    const bd = h("div", { class: "backdrop sl-bd" + (/sl-confirm/.test(cls) ? " sl-bd-small" : "") }, box);
    const api = {
      el: box, closed: false,
      close(force) {
        if (api.closed) return;
        if (!force && opts.beforeClose && opts.beforeClose() === false) return;
        api.closed = true; stack.splice(stack.indexOf(api), 1);
        bd.classList.add("closing"); setTimeout(() => bd.remove(), 180);
        opts.onClose && opts.onClose();
      },
    };
    bd.addEventListener("mousedown", e => { if (e.target === bd) api.close(); });
    stack.push(api); document.getElementById("layer").append(bd);
    return api;
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !stack.length || document.querySelector("#layer .pop")) return;
    e.stopPropagation(); stack[stack.length - 1].close();
  });
  const mhead = (title, m, ...right) => h("div", { class: "sl-m-head" }, typeof title === "string" ? h("b", { text: title }) : title, h("span", { class: "grow" }), ...right,
    h("button", { class: "icon-btn", type: "button", title: "Close", html: UI.icon("x"), onclick: () => m.close() }));
  function ask(msg, ok = "Delete", title = "Are you sure?") {
    return new Promise(res => {
      let done = false;
      const m = overlay("sl-confirm", { onClose: () => !done && res(false) });
      const okBtn = h("button", { class: "btn primary", text: ok, onclick: () => { done = true; res(true); m.close(true); } });
      m.el.append(mhead(title, m), h("div", { class: "sl-m-body" }, h("p", { class: "sl-confirm-t", text: msg })),
        h("div", { class: "sl-m-foot" }, h("span", { class: "grow" }), h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), okBtn));
      setTimeout(() => okBtn.focus(), 60);
    });
  }

  /* ---------- money maths ---------- */
  function line(it) {
    const gross = num(it.qty) * num(it.price), disc = gross * Math.min(100, Math.max(0, num(it.discount))) / 100, net = gross - disc, tax = net * num(it.tax) / 100;
    return { gross, disc, net, tax, total: net + tax };
  }
  // tax is added on top of the discounted price; the result is rounded to cents
  function totals(items) {
    const t = { subtotal: 0, discount: 0, net: 0, tax: 0, total: 0 };
    (items || []).forEach(it => { const l = line(it); t.subtotal += l.gross; t.discount += l.disc; t.net += l.net; t.tax += l.tax; t.total += l.total; });
    for (const k in t) t[k] = r2(t[k]);
    return t;
  }
  const sumBy = list => { const m = {}; list.forEach(x => { const c = x.currency || defCur(); m[c] = (m[c] || 0) + totals(x.items).total; }); return m; };
  function moneyMulti(m) {
    const main = defCur(), keys = Object.keys(m).sort((a, b) => (b === main) - (a === main));
    return keys.length ? keys.map(k => fmt(m[k], k, true)).join(" + ") : fmt(0, main, true);
  }

  /* ---------- numbering: read the next number, use it, save next + 1 ---------- */
  function peekNumber(kind) {
    const c = company(), inv = kind === "invoice";
    const prefix = c[inv ? "invoicePrefix" : "estimatePrefix"] ?? (inv ? "INV-" : "EST-");
    let next = Math.max(1, parseInt(c[inv ? "nextInvoice" : "nextEstimate"]) || 1);
    const used = new Set(Data.list("quotes").filter(q => q.kind === kind).map(q => q.number));
    while (used.has(prefix + pad(next))) next++;
    return { prefix, next, number: prefix + pad(next), key: inv ? "nextInvoice" : "nextEstimate" };
  }
  function takeNumber(kind) { const p = peekNumber(kind); Data.update("settings", "company", { [p.key]: p.next + 1 }); return p.number; }
  function bumpNumber(kind, number) {
    const p = peekNumber(kind), rest = number.startsWith(p.prefix) ? number.slice(p.prefix.length) : "";
    if (/^\d+$/.test(rest) && parseInt(rest) >= p.next) Data.update("settings", "company", { [p.key]: parseInt(rest) + 1 });
  }

  /* ---------- products ---------- */
  const inv = () => !!(window.InventoryAPI && typeof InventoryAPI.stock === "function");
  const stockOf = p => { try { return num(InventoryAPI.stock(p.id)); } catch { return null; } };
  const isLow = (p, s) => !!p.track && (s <= 0 || (num(p.minStock) > 0 && s < num(p.minStock)));
  const activeProducts = () => Data.list("products").filter(p => p.active !== false && !p.deleted);
  const thumb = (p, size = 30) => { const d = fileData(p.image); return h("span", { class: "sl-thumb", style: { width: size + "px", height: size + "px", fontSize: Math.round(size * .5) + "px" } }, d ? h("img", { src: d, alt: "" }) : h("span", { text: p.kind === "service" ? "🛠️" : "📦" })); };
  function stockLine(p) {
    if (!inv() || p.kind === "service") return null;
    const s = stockOf(p); if (s == null) return null;
    const low = isLow(p, s);
    return h("span", { class: "sl-stock" + (low ? " low" : ""), title: low ? `Below minimum stock (${qtyFmt(p.minStock)})` : "", text: (low ? "⚠ " : "") + "In stock: " + qtyFmt(s) + (p.unit ? " " + p.unit : "") });
  }
  function usage(id) {
    const quotes = Data.list("quotes").filter(x => (x.items || []).some(i => i.product === id)).length;
    const deals = Data.list("deals").filter(x => (x.products || []).some(i => i.product === id)).length;
    const docs = inv() ? Data.list("inventory").filter(x => (x.items || []).some(i => i.product === id)).length : 0;
    return { quotes, deals, docs, any: quotes + deals + docs > 0 };
  }

  function editProduct(product) {
    product = product || {};
    const existing = product.id && Data.get("products", product.id);
    const isNew = !existing;
    const v = { name: "", kind: "product", sku: "", price: "", unit: "pcs", tax: 0, category: "", desc: "", image: null, active: true, track: false, minStock: 0, vendor: "", ...clone(existing || product) };
    return new Promise(resolve => {
      let done = false;
      const m = overlay("sl-prod-modal", { onClose: () => !done && resolve(null) });
      const inp = (key, attrs = {}) => { const el = h("input", { class: "menu-input", ...attrs }); el.value = v[key] ?? ""; el.addEventListener("input", () => { v[key] = el.value; }); return el; };
      const nameIn = inp("name", { placeholder: "e.g. Website design", maxlength: 200 });
      const unitIn = inp("unit", { placeholder: "pcs", list: dl("sl-units", UNITS) });
      const kindSeg = seg([["product", "📦 Product"], ["service", "🛠️ Service"]], v.kind, k => {
        v.kind = k;
        if (k === "service" && (!v.unit || v.unit === "pcs")) { v.unit = "hour"; unitIn.value = "hour"; }
        if (k === "product" && v.unit === "hour") { v.unit = "pcs"; unitIn.value = "pcs"; }
        paintImg(); paintStock();
      });
      const skuIn = inp("sku", { placeholder: "Optional" });
      const catIn = inp("category", { placeholder: "e.g. Hardware", list: dl("sl-cats", Data.list("products").map(p => (p.category || "").trim()).sort()) });
      const numAttrs = { type: "number", step: "any", min: "0", inputmode: "decimal", placeholder: "0" };
      const priceIn = inp("price", numAttrs), taxIn = inp("tax", numAttrs), minIn = inp("minStock", numAttrs);
      const descIn = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "What's included, size, colour…" });
      descIn.value = v.desc || ""; descIn.oninput = () => (v.desc = descIn.value);
      const comps = live("companies").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const vendors = comps.filter(c => c.type === "vendor"), others = comps.filter(c => c.type !== "vendor");
      const opt = c => h("option", { value: c.id, text: c.name || "Untitled" });
      const vendSel = h("select", { class: "menu-input" }, h("option", { value: "", text: "No vendor" }),
        vendors.length ? h("optgroup", { label: "Vendors" }, ...vendors.map(opt)) : null,
        others.length ? h("optgroup", { label: vendors.length ? "Other companies" : "Companies" }, ...others.map(opt)) : null);
      vendSel.value = v.vendor && Data.get("companies", v.vendor) ? v.vendor : ""; vendSel.onchange = () => (v.vendor = vendSel.value);

      const imgBox = h("button", { type: "button", class: "sl-pe-img", title: "Add a picture" });
      function paintImg() {
        const d = fileData(v.image);
        imgBox.replaceChildren(d ? h("img", { src: d, alt: "" }) : h("span", { class: "sl-pe-ph" }, h("b", { text: v.kind === "service" ? "🛠️" : "📦" }), h("small", { text: "Add picture" })),
          v.image ? h("span", { class: "sl-pe-x", title: "Remove picture", text: "×", onclick: e => { e.stopPropagation(); v.image = null; paintImg(); } }) : null);
      }
      imgBox.onclick = async () => {
        const [f] = await Apps.pickFiles(false); if (!f) return;
        if (!/^image\//.test(f.type)) return UI.toast("Pick an image file");
        imgBox.classList.add("busy");
        const [att] = await Apps.attach([await shrinkImage(f, 640)]);
        imgBox.classList.remove("busy");
        if (att) { v.image = att; paintImg(); }
      };
      const stockBox = h("div");
      function paintStock() {
        if (v.kind === "service") return stockBox.replaceChildren();
        const cur = existing && inv() ? stockOf(existing) : null;
        stockBox.replaceChildren(h("div", { class: "sl-sec", text: "Stock" }),
          switchRow("Track stock", "Count how many you have in Inventory", !!v.track, on => { v.track = on; paintStock(); }),
          v.track ? h("div", { class: "sl-grid" }, field("Minimum stock", minIn, "half"),
            cur != null ? h("div", { class: "sl-f half sl-stock-now" + (isLow(v, cur) ? " low" : "") }, h("span", { text: "In stock now" }), h("b", { text: qtyFmt(cur) + (v.unit ? " " + v.unit : "") + (isLow(v, cur) ? "  ⚠ low" : "") })) : null) : null);
      }
      async function save() {
        const name = String(v.name || "").trim();
        if (!name) { UI.toast("Give the product a name"); return nameIn.focus(); }
        const sku = String(v.sku || "").trim();
        if (sku && Data.list("products").some(p => p.id !== existing?.id && (p.sku || "").trim().toLowerCase() === sku.toLowerCase())
          && !await ask(`Another product already uses SKU “${sku}”. Save anyway?`, "Save", "Same SKU")) return;
        const data = { name, sku, kind: v.kind === "service" ? "service" : "product", price: r2(num(v.price)), unit: String(v.unit || "").trim() || "pcs", tax: num(v.tax),
          category: String(v.category || "").trim(), desc: String(v.desc || "").trim(), image: v.image || null, active: v.active !== false, track: !!v.track, minStock: num(v.minStock), vendor: v.vendor || "" };
        let id;
        if (isNew) { id = Data.uid(); Data.add("products", data, id); } else { id = existing.id; Data.update("products", id, data); }
        done = true; m.close(true);
        UI.toast(isNew ? `📦 “${name}” added to the catalog` : "Product saved");
        resolve(id);
      }
      const body = h("div", { class: "sl-m-body" },
        h("div", { class: "sl-pe-top" }, imgBox, h("div", { class: "sl-pe-main" }, field("Name", nameIn, "full"), kindSeg)),
        h("div", { class: "sl-grid" }, field("Price", priceIn, "third"), field("Unit", unitIn, "third"), field("Tax %", taxIn, "third"),
          field("SKU", skuIn, "half"), field("Category", catIn, "half"), field("Description", descIn, "full"), field("Vendor", vendSel, "full")),
        stockBox,
        h("div", { class: "sl-sec", text: "Availability" }),
        switchRow("Active", "Archived products stay on old documents but don't show up in pickers", v.active !== false, on => (v.active = on)));
      body.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); save(); } });
      m.el.append(mhead(isNew ? "New product" : "Edit product", m), body,
        h("div", { class: "sl-m-foot" },
          !isNew ? h("button", { class: "btn danger", text: "Delete", onclick: async () => { if (await removeProducts([existing.id])) { done = true; m.close(true); resolve(null); } } }) : null,
          h("span", { class: "grow" }), h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { class: "btn primary", text: isNew ? "Add product" : "Save", onclick: save })));
      paintImg(); paintStock();
      if (isNew) setTimeout(() => (v.name ? priceIn : nameIn).focus(), 60);
    });
  }

  // products used on documents or deals are archived instead of deleted
  async function removeProducts(ids) {
    const used = ids.filter(id => usage(id).any), free = ids.filter(id => !used.includes(id));
    if (used.length) {
      const all = used.length === ids.length;
      const msg = all ? (ids.length === 1 ? "This product is used in estimates, invoices or deals, so it can't be deleted. Archive it instead? It stays on old documents but won't show up in pickers."
        : "These products are used in estimates, invoices or deals, so they can't be deleted. Archive them instead?")
        : `${used.length} of ${ids.length} products are used in estimates, invoices or deals and can't be deleted. Archive those and delete the other ${free.length}?`;
      if (!await ask(msg, all ? "Archive" : "Archive and delete", "Can't delete")) return false;
      used.forEach(id => Data.update("products", id, { active: false }));
      free.forEach(id => Data.remove("products", id));
      UI.toast(all ? `Archived ${plural(used.length, "product")}` : `Archived ${used.length}, deleted ${free.length}`);
      return true;
    }
    if (!await ask(ids.length === 1 ? "Delete this product for good?" : `Delete ${ids.length} products for good?`)) return false;
    ids.forEach(id => Data.remove("products", id));
    UI.toast(`Deleted ${plural(ids.length, "product")}`);
    return true;
  }

  /* popover: search active products by name / SKU; "+ New product" creates one and picks it */
  function productPicker(anchor, onPick, opts = {}) {
    let hl = 0, shown = [], api;
    const inp = h("input", { class: "menu-input", type: "search", placeholder: "Search products or SKU…" });
    const list = h("div", { class: "sl-pp-list" });
    const pick = p => { api && api.close(); onPick(p); };
    const newOne = async () => {
      const q = inp.value.trim(); api && api.close();
      const id = await editProduct(q ? { name: q } : null);
      const p = id && Data.get("products", id);
      if (p) onPick(p);
    };
    function draw() {
      const q = inp.value.trim().toLowerCase();
      shown = activeProducts().filter(p => !q || [p.name, p.sku, p.category].join(" ").toLowerCase().includes(q))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, 80);
      hl = Math.max(0, Math.min(hl, shown.length - 1));
      list.replaceChildren(...shown.map((p, i) => h("button", { type: "button", class: "mi compact sl-pp-item" + (i === hl ? " hl" : ""), onclick: () => pick(p), onmouseenter: () => { hl = i; list.querySelectorAll(".sl-pp-item").forEach((b, j) => b.classList.toggle("hl", j === i)); } },
        thumb(p, 30), h("span", { class: "sl-pp-n" }, h("span", { class: "mi-t", text: p.name || "Untitled" }), h("small", { text: [p.sku, p.category].filter(Boolean).join(" · ") || (p.kind === "service" ? "Service" : "Product") })),
        h("span", { class: "sl-pp-price", text: fmt(p.price) + (p.unit ? " / " + p.unit : "") }))));
      if (!shown.length) list.append(h("div", { class: "menu-empty", text: q ? `No products match “${inp.value.trim()}”.` : "No products yet." }));
      list.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
    }
    inp.addEventListener("input", () => { hl = 0; draw(); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); hl = Math.min(hl + 1, shown.length - 1); draw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hl = Math.max(hl - 1, 0); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); shown[hl] ? pick(shown[hl]) : newOne(); }
    });
    draw();
    const foot = h("div", { class: "sl-pp-foot" },
      h("button", { type: "button", class: "mi compact", onclick: newOne }, h("span", { class: "mi-ic", text: "＋" }), h("span", { class: "mi-t", text: "New product" })),
      opts.free ? h("button", { type: "button", class: "mi compact", onclick: () => { const q = inp.value.trim(); api.close(); opts.free(q); } }, h("span", { class: "mi-ic", text: "✏️" }), h("span", { class: "mi-t", text: "Free text row" })) : null);
    api = UI.popover(anchor, h("div", { class: "sl-pp" }, inp, list, foot), { className: "sl-pop", align: opts.align });
    setTimeout(() => inp.focus(), 30);
    return api;
  }

  /* ---------- CSV import / export ---------- */
  const csvCell = v => { const s = String(v ?? ""); return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    const first = text.split(/\r?\n/)[0] || "";
    const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === d) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  function parseMoney(s) {
    s = String(s ?? "").replace(/[^\d.,-]/g, "");
    if (!s) return 0;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lc > -1) s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
    const x = parseFloat(s); return isFinite(x) ? x : 0;
  }
  const CSV_HEAD = ["name", "sku", "price", "unit", "tax", "category"];
  function exportCSV() {
    const rows = Data.list("products").filter(p => !p.deleted).sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map(p => [p.name, p.sku, num(p.price), p.unit, num(p.tax), p.category]);
    if (!rows.length) return UI.toast("No products to export yet");
    download("products.csv", "﻿" + [CSV_HEAD, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    UI.toast(`Exported ${plural(rows.length, "product")}`);
  }
  const csvTemplate = () => download("products-template.csv", "﻿" + [CSV_HEAD, ["Website design", "WEB-001", "1200", "pcs", "18", "Services"]].map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  async function importCSV() {
    const [f] = await Apps.pickFiles(false); if (!f) return;
    const rows = parseCSV(await f.text());
    if (rows.length < 2) return UI.toast("No products found in that file");
    const head = rows[0].map(x => x.trim().toLowerCase().replace(/[%()]/g, "").replace(/\s+/g, " ").trim());
    const col = names => head.findIndex(x => names.includes(x));
    const I = { name: col(["name", "product", "product name", "title", "item"]), sku: col(["sku", "code", "article", "item code"]), price: col(["price", "unit price", "rate"]),
      unit: col(["unit", "uom", "measure", "unit of measure"]), tax: col(["tax", "vat", "gst", "tax rate"]), category: col(["category", "group", "section"]),
      kind: col(["kind", "type"]), desc: col(["description", "desc", "details"]) };
    if (I.name < 0) return UI.toast("The file needs a “name” column");
    const get = (r, k) => I[k] < 0 ? undefined : String(r[I[k]] ?? "").trim();
    const items = rows.slice(1).map(r => ({ name: get(r, "name"), sku: get(r, "sku"), price: get(r, "price"), unit: get(r, "unit"), tax: get(r, "tax"), category: get(r, "category"), kind: get(r, "kind"), desc: get(r, "desc") })).filter(x => x.name);
    if (!items.length) return UI.toast("No products found in that file");
    const bySku = new Map(Data.list("products").filter(p => p.sku).map(p => [p.sku.trim().toLowerCase(), p]));
    const upd = items.filter(x => x.sku && bySku.has(x.sku.toLowerCase())).length;
    if (!await ask(`Import ${plural(items.length, "product")} from “${f.name}”? ${items.length - upd} new${upd ? `, ${upd} updated (same SKU)` : ""}.`, "Import", "Import products")) return;
    items.forEach(x => {
      const data = {};
      data.name = x.name;
      if (x.sku !== undefined) data.sku = x.sku;
      if (x.price !== undefined) data.price = r2(parseMoney(x.price));
      if (x.unit) data.unit = x.unit;
      if (x.tax !== undefined) data.tax = parseMoney(x.tax);
      if (x.category !== undefined) data.category = x.category;
      if (x.kind) data.kind = /serv/i.test(x.kind) ? "service" : "product";
      if (x.desc !== undefined) data.desc = x.desc;
      const ex = x.sku && bySku.get(x.sku.toLowerCase());
      if (ex) Data.update("products", ex.id, data);
      else Data.add("products", { kind: "product", sku: "", price: 0, unit: "pcs", tax: 0, category: "", desc: "", image: null, active: true, track: false, minStock: 0, vendor: "", ...data });
    });
    UI.toast(`📥 Imported ${plural(items.length, "product")}`);
  }

  /* ---------- catalog view ---------- */
  function renderProducts(root) {
    let q = "", cat = "", st = "active", view = ls("lumen-sales-pview") === "list" ? "list" : "grid", raf = 0;
    const sel = new Set();
    const search = h("input", { class: "app-search", type: "search", placeholder: "Search products…", oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); } });
    const catSel = h("select", { class: "app-select", title: "Category", onchange: () => { cat = catSel.value; draw(); } });
    const stSeg = seg([["active", "Active"], ["archived", "Archived"], ["all", "All"]], st, k => { st = k; sel.clear(); draw(); });
    const viewSeg = seg([["grid", UI.icon("gallery"), "Grid"], ["list", UI.icon("table"), "List"]], view, k => { view = k; ls("lumen-sales-pview", k); draw(); });
    viewSeg.classList.add("sl-viewseg");
    const csvBtn = h("button", { class: "btn", title: "Import or export products as CSV", text: "CSV" });
    csvBtn.onclick = () => UI.menu(csvBtn, [{ label: "Import from CSV", icon: "plus", onClick: importCSV }, { label: "Export to CSV", icon: "download", onClick: exportCSV }, { sep: true }, { label: "Download a template", icon: "page", onClick: csvTemplate }], { align: "end" });
    const addBtn = h("button", { class: "btn primary", text: "+ New product", onclick: () => editProduct() });
    const bulk = h("div", { class: "sl-bulk" }), body = h("div", { class: "sl-pbody" });
    root.append(h("div", { class: "sl-wrap" }, h("div", { class: "app-toolbar sl-toolbar" }, search, catSel, stSeg, h("span", { class: "grow" }), viewSeg, csvBtn, addBtn), bulk, body));

    const check = p => h("input", { type: "checkbox", class: "sl-check", checked: sel.has(p.id), title: "Select", "aria-label": "Select " + (p.name || "product"),
      onclick: e => e.stopPropagation(),
      onchange: e => { e.target.checked ? sel.add(p.id) : sel.delete(p.id); e.target.closest(".sl-pcard,.sl-tr")?.classList.toggle("sel", e.target.checked); drawBulk(); } });
    function drawBulk() {
      if (!sel.size) { bulk.classList.remove("on"); bulk.replaceChildren(); return; }
      const ids = [...sel], ps = ids.map(id => Data.get("products", id)).filter(Boolean);
      const setActive = on => { ids.forEach(id => Data.update("products", id, { active: on })); UI.toast(`${on ? "Restored" : "Archived"} ${plural(ids.length, "product")}`); sel.clear(); draw(); };
      bulk.classList.add("on");
      bulk.replaceChildren(h("span", { class: "sl-bulk-n", text: `${sel.size} selected` }),
        ps.some(p => p.active !== false) ? h("button", { class: "btn", text: "Archive", onclick: () => setActive(false) }) : null,
        ps.some(p => p.active === false) ? h("button", { class: "btn", text: "Restore", onclick: () => setActive(true) }) : null,
        h("button", { class: "btn danger", text: "Delete", onclick: async () => { if (await removeProducts(ids)) { sel.clear(); draw(); } } }),
        h("span", { class: "grow" }), h("button", { class: "btn", text: "Clear", onclick: () => { sel.clear(); draw(); } }));
    }
    function grid(rows) {
      return h("div", { class: "sl-pgrid" }, ...rows.map((p, i) => {
        const d = fileData(p.image);
        return h("div", { class: "sl-pcard glass" + (sel.has(p.id) ? " sel" : "") + (p.active === false ? " archived" : ""), style: { animationDelay: Math.min(i, 16) * 22 + "ms" }, onclick: () => editProduct(p) },
          check(p),
          h("div", { class: "sl-pimg" }, d ? h("img", { src: d, alt: "", loading: "lazy" }) : h("span", { text: p.kind === "service" ? "🛠️" : "📦" })),
          h("div", { class: "sl-pc-body" },
            h("div", { class: "sl-pc-name", text: p.name || "Untitled" }),
            h("div", { class: "sl-pc-meta", text: [p.sku, p.category].filter(Boolean).join(" · ") || (p.kind === "service" ? "Service" : "Product") }),
            h("div", { class: "sl-pc-price" }, fmt(p.price), p.unit ? h("small", { text: " / " + p.unit }) : null),
            h("div", { class: "sl-pc-tags" }, p.kind === "service" ? tagEl("Service", "purple") : null, p.active === false ? tagEl("Archived", "gray") : null,
              num(p.tax) ? tagEl("Tax " + qtyFmt(p.tax) + "%", "blue") : null, stockLine(p))));
      }));
    }
    function table(rows) {
      const cols = "28px 40px minmax(160px,2fr) minmax(90px,1fr) 110px 70px 64px minmax(110px,1fr) 90px";
      const all = h("input", { type: "checkbox", class: "sl-check", title: "Select all", checked: rows.every(p => sel.has(p.id)), onchange: e => { rows.forEach(p => e.target.checked ? sel.add(p.id) : sel.delete(p.id)); draw(); } });
      return h("div", { class: "sl-table sl-ptable glass" },
        h("div", { class: "sl-tr head", style: { "--cols": cols } }, all, h("span"), h("span", { text: "Name" }), h("span", { text: "Category" }), h("span", { class: "r", text: "Price" }),
          h("span", { text: "Unit" }), h("span", { class: "r", text: "Tax" }), h("span", { text: inv() ? "Stock" : "Kind" }), h("span", { text: "Status" })),
        ...rows.map((p, i) => h("div", { class: "sl-tr" + (sel.has(p.id) ? " sel" : "") + (p.active === false ? " archived" : ""), style: { "--cols": cols, animationDelay: Math.min(i, 16) * 16 + "ms" }, onclick: () => editProduct(p) },
          check(p), thumb(p, 34),
          h("span", { class: "c-pname" }, h("b", { class: "sl-ell", text: p.name || "Untitled" }), p.sku ? h("small", { text: p.sku }) : null),
          h("span", { class: "c-cat sl-ell", text: p.category || "—" }),
          h("span", { class: "c-price r", text: fmt(p.price) }),
          h("span", { class: "c-unit", text: p.unit || "" }),
          h("span", { class: "c-tax r", text: num(p.tax) ? qtyFmt(p.tax) + "%" : "—" }),
          h("span", { class: "c-stock" }, inv() ? (stockLine(p) || "—") : (p.kind === "service" ? "Service" : "Product")),
          h("span", { class: "c-st" }, p.active === false ? tagEl("Archived", "gray") : tagEl("Active", "green")))));
    }
    function draw() {
      const all = Data.list("products").filter(p => !p.deleted);
      const cats = uniq(all.map(p => (p.category || "").trim())).sort((a, b) => a.localeCompare(b));
      if (cat && !cats.includes(cat)) cat = "";
      catSel.replaceChildren(h("option", { value: "", text: "All categories" }), ...cats.map(c => h("option", { value: c, text: c })));
      catSel.value = cat; catSel.style.display = cats.length ? "" : "none";
      const rows = all.filter(p => (st === "all" || (st === "active") === (p.active !== false)) && (!cat || (p.category || "").trim() === cat)
        && (!q || [p.name, p.sku, p.category, p.desc].join(" ").toLowerCase().includes(q))).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      [...sel].forEach(id => { if (!rows.some(p => p.id === id)) sel.delete(id); });
      drawBulk();
      if (!all.length) return body.replaceChildren(Apps.empty("📦", "No products yet. Add what you sell once, then reuse it in deals, estimates and invoices.",
        h("div", { class: "sl-empty-btns" }, h("button", { class: "btn primary", text: "+ New product", onclick: () => editProduct() }), h("button", { class: "btn", text: "Import CSV", onclick: importCSV }))));
      if (!rows.length) return body.replaceChildren(h("div", { class: "sl-none glass", text: st === "archived" && !q && !cat ? "No archived products." : "No products match." }));
      body.replaceChildren(view === "grid" ? grid(rows) : table(rows));
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    const offs = [Data.on("products", schedule), Data.on("files", schedule)];
    if (inv()) offs.push(Data.on("inventory", schedule));
    draw();
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  }

  /* ---------- quotes: estimates and invoices ---------- */
  function normItems(list) {
    return (list || []).map(it => {
      const p = it.product && Data.get("products", it.product);
      return { ...(it.product ? { product: it.product } : {}), name: it.name ?? p?.name ?? "", qty: it.qty === "" ? "" : it.qty == null ? 1 : num(it.qty), unit: it.unit || p?.unit || "pcs",
        price: it.price === "" ? "" : num(it.price ?? p?.price), discount: num(it.discount), tax: it.tax == null ? num(p?.tax) : num(it.tax) };
    });
  }
  const cleanItem = it => ({ ...(it.product ? { product: it.product } : {}), name: String(it.name || "").trim(), qty: num(it.qty), unit: String(it.unit || "").trim(),
    price: num(it.price), discount: Math.min(100, Math.max(0, num(it.discount))), tax: num(it.tax) });
  const filled = it => String(it.name || "").trim() || it.product || num(it.price);
  const applyProduct = (it, p) => Object.assign(it, { product: p.id, name: p.name || "", unit: p.unit || "pcs", price: num(p.price), tax: num(p.tax), qty: it.qty === "" || it.qty == null ? 1 : it.qty, discount: it.discount ?? 0 });
  function blankQuote(kind, o = {}) {
    const c = company(), t = Apps.today();
    return { kind, number: "", title: "", deal: "", contact: "", company: "", items: [], currency: defCur(), status: "draft", issue: t, due: Apps.addDays(t, kind === "invoice" ? 14 : 30),
      notes: (kind === "invoice" ? c.invoiceNotes : c.estimateNotes) || "", terms: c.terms || "", owner: meKey(), paidAt: null, fromEstimate: "", deleted: false, ...o };
  }
  function pack(s) {
    const o = { kind: s.kind, number: String(s.number || "").trim(), title: String(s.title || "").trim(), deal: s.deal || "", contact: s.contact || "", company: s.company || "",
      items: (s.items || []).filter(filled).map(cleanItem), currency: s.currency || defCur(), status: s.status === "overdue" ? "sent" : s.status || "draft",
      issue: s.issue || "", due: s.due || "", notes: s.notes || "", terms: s.terms || "", owner: s.owner || "", paidAt: s.paidAt || null, fromEstimate: s.fromEstimate || "", deleted: !!s.deleted };
    ["sentAt", "acceptedAt", "declinedAt", "cancelledAt"].forEach(k => { if (s[k]) o[k] = s[k]; });
    return o;
  }
  // "overdue" is worked out on the fly (sent + due date passed); stored status stays "sent"
  const dispStatus = q => { const s = q.status || "draft"; if (q.kind === "invoice" && (s === "sent" || s === "overdue")) return q.due && q.due < Apps.today() ? "overdue" : "sent"; return s; };
  const statusDef = q => STATUS[q.kind === "estimate" ? "estimate" : "invoice"][dispStatus(q)] || ["Draft", "gray"];
  const pill = q => { const [l, c] = statusDef(q); return h("span", { class: "sl-pill", dataset: { tc: c } }, h("i"), l); };
  const clientName = q => nameOf("companies", q.company) || nameOf("contacts", q.contact) || nameOf("deals", q.deal) || "—";
  const converted = est => Data.list("quotes").find(x => x.fromEstimate === est.id && !x.deleted);
  function statusPatch(q, k) {
    const now = Date.now(), p = { status: k };
    if (k === "sent" && !q.sentAt) p.sentAt = now;
    if (q.kind === "invoice" && k !== "paid") p.paidAt = null;
    if (k === "paid") p.paidAt = now;
    if (k === "accepted") p.acceptedAt = now;
    if (k === "declined") p.declinedAt = now;
    if (k === "cancelled") p.cancelledAt = now;
    return p;
  }
  function statusActions(q) {
    const st = dispStatus(q);
    if (q.kind === "estimate") return ({
      draft: [["Mark as sent", "sent", "primary"], ["Convert to invoice", "convert"]],
      sent: [["Accepted", "accepted", "primary"], ["Declined", "declined"], ["Convert to invoice", "convert"]],
      accepted: [["Convert to invoice", "convert", "primary"], ["Back to sent", "sent"]],
      declined: [["Reopen", "draft"]],
    })[st] || [];
    const unpaid = [["Mark as paid", "paid", "primary"], ["Cancel invoice", "cancelled", "danger"]];
    return ({ draft: [["Mark as sent", "sent", "primary"], ["Mark as paid", "paid"], ["Cancel invoice", "cancelled", "danger"]], sent: unpaid, overdue: unpaid,
      paid: [["Mark as unpaid", "sent"]], cancelled: [["Reopen", "draft"]] })[st] || [];
  }
  const stName = (kind, k) => (STATUS[kind][k] || [k])[0].toLowerCase();

  function stagesFor(d) {
    const fn = window.Apps?.CRM?.stagesFor;
    if (typeof fn !== "function") return null;
    try {
      return (fn(d.pipeline || "default") || []).map(x => Array.isArray(x) ? { id: x[0], name: x[1], color: x[2], sem: x[0] === "won" ? "won" : x[0] === "lost" ? "lost" : "process" } : x);
    } catch (e) { console.warn(e); return null; }
  }
  // invoice paid: tell the deal owner, and offer to win the deal
  function afterPaid(q) {
    const d = q.deal && Data.get("deals", q.deal);
    if (!d || d.deleted) return;
    const t = totals(q.items), me = Data.me();
    if (d.owner && d.owner !== me.key) Data.notify(d.owner, `💰 <b>${esc(me.name)}</b> marked invoice ${esc(q.number || "")} as paid on your deal “${esc(d.title || "")}”`, "#/app/crm/invoices", fmt(t.total, q.currency));
    const stages = stagesFor(d); if (!stages || !stages.length) return;
    const won = stages.find(x => x.sem === "won"), cur = stages.find(x => x.id === d.stage);
    if (!won || d.stage === won.id || cur?.sem === "won") return;
    setTimeout(() => UI.toast(`Invoice paid. Move “${d.title || "the deal"}” to ${won.name}?`, { label: "Move to " + won.name, run: () => {
      Data.update("deals", d.id, { stage: won.id, closedAt: Date.now() });
      UI.toast(`🏆 Deal won: ${d.title || ""}`);
    } }), 400);
  }
  function quickStatus(q, k) {
    const patch = statusPatch(q, k);
    Data.update("quotes", q.id, patch);
    const nq = { ...q, ...patch };
    UI.toast(`${KIND[q.kind].One} ${q.number || ""} marked as ${stName(q.kind, k)}`);
    if (k === "paid") afterPaid(nq);
  }
  async function convertEstimate(est) {
    if (!est) return null;
    const ex = converted(est);
    if (ex) { if (await ask(`This estimate is already converted to invoice ${ex.number}. Open that invoice?`, "Open invoice", "Already converted")) openQuote(ex.id); return null; }
    if (est.status !== "accepted") Data.update("quotes", est.id, { status: "accepted", acceptedAt: est.acceptedAt || Date.now() });
    const c = company(), t = Apps.today(), nid = Data.uid();
    const invq = { kind: "invoice", number: takeNumber("invoice"), title: est.title || "", deal: est.deal || "", contact: est.contact || "", company: est.company || "",
      items: clone(est.items || []), currency: est.currency || defCur(), status: "draft", issue: t, due: Apps.addDays(t, 14), notes: c.invoiceNotes || est.notes || "",
      terms: est.terms || c.terms || "", owner: est.owner || meKey(), paidAt: null, fromEstimate: est.id, deleted: false };
    Data.add("quotes", invq, nid);
    UI.toast(`🧾 Invoice ${invq.number} created from ${est.number || "the estimate"}`);
    openQuote(nid);
    return nid;
  }
  const duplicate = q => openEditor(blankQuote(q.kind, { title: q.title || "", deal: q.deal || "", contact: q.contact || "", company: q.company || "", items: clone(q.items || []),
    currency: q.currency || defCur(), notes: q.notes || "", terms: q.terms || "", owner: meKey() }), true);
  async function softDelete(q) {
    if (!await ask(`Delete ${KIND[q.kind].one} ${q.number || ""}? You can undo it right after.`, "Delete")) return false;
    Data.update("quotes", q.id, { deleted: true });
    UI.toast(`${KIND[q.kind].One} deleted`, { label: "Undo", run: () => Data.update("quotes", q.id, { deleted: false }) });
    return true;
  }

  /* ---------- picker for CRM records (deal / contact / company) ---------- */
  function recordPicker(anchor, col, onPick) {
    let api;
    const label = r => r.title || r.name || "Untitled";
    const sub = r => col === "deals" ? [nameOf("companies", r.company) || nameOf("contacts", r.contact), r.amount ? Apps.money(r.amount) : ""].filter(Boolean).join(" · ")
      : col === "contacts" ? [nameOf("companies", r.company), r.email || r.phone].filter(Boolean).join(" · ") : [r.industry, r.website].filter(Boolean).join(" · ");
    const inp = h("input", { class: "menu-input", type: "search", placeholder: col === "deals" ? "Search deals…" : col === "contacts" ? "Search contacts…" : "Search companies…" });
    const list = h("div", { class: "sl-pp-list" });
    const done = r => { api && api.close(); onPick(r); };
    function draw() {
      const q = inp.value.trim().toLowerCase();
      const rows = live(col).filter(r => !q || (label(r) + " " + sub(r)).toLowerCase().includes(q)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60);
      list.replaceChildren(h("button", { type: "button", class: "mi compact", onclick: () => done(null) }, h("span", { class: "mi-ic", text: "∅" }), h("span", { class: "mi-t", text: "None" })),
        ...rows.map(r => h("button", { type: "button", class: "mi compact", onclick: () => done(r) }, h("span", { class: "sl-pp-n" }, h("span", { class: "mi-t", text: label(r) }), sub(r) ? h("small", { text: sub(r) }) : null))),
        !rows.length ? h("div", { class: "menu-empty", text: q ? "No matches." : "Nothing here yet. Add it in the CRM first." }) : null);
    }
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); list.querySelectorAll(".mi")[1]?.click(); } });
    draw();
    api = UI.popover(anchor, h("div", { class: "sl-pp" }, inp, list), { className: "sl-pop" });
    setTimeout(() => inp.focus(), 30);
    return api;
  }

  /* ---------- quote editor (wide window) ---------- */
  function openEditor(init, isNew) {
    return new Promise(resolve => {
      const s = { ...blankQuote(init.kind === "estimate" ? "estimate" : "invoice"), ...clone(init) };
      s.items = normItems(s.items);
      if (s.status === "overdue") s.status = "sent";
      let id = isNew ? null : init.id, snap = JSON.stringify(pack(s));
      const K = KIND[s.kind], isInv = s.kind === "invoice";
      const isDirty = () => JSON.stringify(pack(s)) !== snap;
      const m = overlay("sl-q-modal", {
        beforeClose: () => { if (!isDirty()) return true; ask("You have unsaved changes. Close without saving them?", "Discard", "Unsaved changes").then(ok => ok && m.close(true)); return false; },
        onClose: () => resolve(id),
      });

      /* header + status actions */
      const titleEl = h("div", { class: "sl-q-title" }), pillBox = h("span", { class: "sl-q-pill" }), actBox = h("div", { class: "sl-q-acts" });
      const moreBtn = h("button", { class: "icon-btn", type: "button", title: "More", html: UI.icon("dots") });
      const printBtn = h("button", { class: "btn sl-print", type: "button", title: "Print or save as PDF", onclick: () => doPrint() }, h("span", { html: UI.icon("download") }), h("span", { class: "sl-print-t", text: "Print / PDF" }));
      moreBtn.onclick = () => UI.menu(moreBtn, [
        { label: "Duplicate", icon: "copy", onClick: () => duplicate(pack(s)) },
        !isInv ? { label: "Convert to invoice", icon: "turn", onClick: () => doStatus("convert") } : null,
        { label: "Company details", iconHtml: "🏢", onClick: () => settings() },
        id ? { sep: true } : null,
        id ? { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await softDelete({ ...pack(s), id })) m.close(true); } } : null,
      ], { align: "end" });

      /* fields */
      const changed = () => saveBtn.classList.toggle("sl-dirty", isDirty());
      const inp = (key, attrs = {}, after) => { const el = h("input", { class: "menu-input", ...attrs }); el.value = s[key] ?? ""; el.addEventListener("input", () => { s[key] = el.value; after && after(); changed(); }); return el; };
      const titleIn = inp("title", { placeholder: isInv ? "e.g. Website redesign, first payment" : "e.g. Proposal for website redesign", maxlength: 200 }, () => paintHead());
      const numberIn = inp("number", { placeholder: "Auto: " + peekNumber(s.kind).number, maxlength: 40 });
      const issueIn = inp("issue", { type: "date" }), dueIn = inp("due", { type: "date" }, () => paintHead());
      const curSel = select(uniq([s.currency, defCur(), ...CURRENCIES]).map(c => [c, c]), s.currency, v => { s.currency = v; drawItems(); changed(); }, "menu-input");
      const ownerBtn = h("button", { type: "button", class: "menu-input f-person" });
      const paintOwner = () => ownerBtn.replaceChildren(s.owner ? Apps.avatar(Data.person(s.owner), 20) : "", h("span", { text: s.owner ? Data.person(s.owner).name : "Choose someone…" }));
      ownerBtn.onclick = () => Apps.personPicker(ownerBtn, p => { s.owner = p ? p.key : ""; paintOwner(); changed(); }, { allowNone: true });
      const ta = (key, ph) => { const el = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: ph }); el.value = s[key] || ""; el.oninput = () => { s[key] = el.value; changed(); }; return el; };

      /* client */
      const CK = { deals: "deal", contacts: "contact", companies: "company" };
      const clientBox = h("div", { class: "sl-client" });
      function fromDeal(d) {
        if (!s.contact && d.contact) s.contact = d.contact;
        if (!s.company && d.company) s.company = d.company;
        if (!String(s.title || "").trim() && d.title) { s.title = d.title; titleIn.value = d.title; paintHead(); }
        if (!s.items.filter(filled).length && (d.products || []).length) { s.items = normItems(d.products); drawItems(); }
      }
      function paintClient() {
        const c = Data.get("contacts", s.contact), co = Data.get("companies", s.company);
        const info = [c?.email, c?.phone || co?.phone, co?.website].filter(Boolean);
        clientBox.replaceChildren(...[["deals", "Deal", "💼"], ["companies", "Company", "🏢"], ["contacts", "Contact", "👤"]].map(([col, label, ic]) => {
          const key = CK[col], rec = s[key] && Data.get(col, s[key]);
          const b = h("button", { type: "button", class: "menu-input sl-rec-btn" + (rec ? "" : " empty") }, h("span", { class: "sl-rec-ic", text: ic }),
            h("span", { class: "sl-ell", text: rec ? (rec.title || rec.name || "Untitled") : s[key] ? "(deleted)" : "Choose " + label.toLowerCase() + "…" }),
            s[key] ? h("span", { class: "sl-rec-x", role: "button", title: "Clear", text: "×", onclick: e => { e.stopPropagation(); s[key] = ""; paintClient(); changed(); } }) : null);
          b.onclick = () => recordPicker(b, col, r => {
            s[key] = r ? r.id : "";
            if (r && col === "deals") fromDeal(r);
            if (r && col === "contacts" && !s.company && r.company) s.company = r.company;
            paintClient(); changed();
          });
          return field(label, b);
        }), info.length ? h("div", { class: "sl-client-info", text: info.join(" · ") }) : null);
      }

      /* items */
      const rowsEl = h("div", { class: "sl-items-rows" }), totalsEl = h("div", { class: "sl-totals" });
      let dragI = null;
      function drawTotals() {
        const t = totals(s.items), F = v => fmt(v, s.currency);
        const row = (l, v, cls) => h("div", { class: "sl-tot-row " + (cls || "") }, h("span", { text: l }), h("b", { text: v }));
        totalsEl.replaceChildren(row("Subtotal", F(t.subtotal)), t.discount ? row("Discount", "−" + F(t.discount)) : null, row("Tax", F(t.tax)), row("Total", F(t.total), "total"));
      }
      function itemRow(it, i) {
        const row = h("div", { class: "sl-it", style: { animationDelay: Math.min(i, 10) * 18 + "ms" } });
        const total = h("span", { class: "sl-it-total", text: fmt(line(it).net, s.currency) });
        const numIn = (key, label, attrs = {}) => {
          const el = h("input", { class: "sl-in sl-num", type: "number", step: "any", inputmode: "decimal", "aria-label": label, ...attrs });
          el.value = it[key] ?? "";
          el.addEventListener("input", () => { it[key] = el.value === "" ? "" : num(el.value); total.textContent = fmt(line(it).net, s.currency); drawTotals(); changed(); });
          return h("label", { class: "sl-cell c-" + key, dataset: { label } }, el);
        };
        const nameIn = h("input", { class: "sl-in sl-in-name", placeholder: "Product or service", "aria-label": "Item" });
        nameIn.value = it.name || ""; nameIn.addEventListener("input", () => { it.name = nameIn.value; changed(); });
        const unitIn = h("input", { class: "sl-in", placeholder: "pcs", list: dl("sl-units", UNITS), "aria-label": "Unit" });
        unitIn.value = it.unit || ""; unitIn.addEventListener("input", () => { it.unit = unitIn.value; changed(); });
        const prod = it.product && Data.get("products", it.product);
        const pick = h("button", { type: "button", class: "icon-btn xs sl-pick" + (prod ? " linked" : ""), title: prod ? "From catalog: " + (prod.name || "") + " (pick another)" : "Pick from catalog", text: "📦" });
        pick.onclick = () => productPicker(pick, p => { applyProduct(it, p); drawItems(); changed(); });
        const handle = h("span", { class: "sl-handle", title: "Drag to reorder", html: UI.icon("drag") });
        handle.addEventListener("mousedown", () => { row.draggable = true; document.addEventListener("mouseup", () => { row.draggable = false; }, { once: true }); });
        handle.addEventListener("touchstart", () => row.setAttribute("draggable", "true"), { passive: true });
        row.addEventListener("dragstart", e => { dragI = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); row.classList.add("dragging"); });
        row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("dragging"); rowsEl.querySelectorAll(".drop-above,.drop-below").forEach(x => x.classList.remove("drop-above", "drop-below")); dragI = null; });
        row.addEventListener("dragover", e => {
          if (dragI == null) return; e.preventDefault();
          const r = row.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
          row.classList.toggle("drop-above", !below); row.classList.toggle("drop-below", below);
        });
        row.addEventListener("dragleave", e => { if (!row.contains(e.relatedTarget)) row.classList.remove("drop-above", "drop-below"); });
        row.addEventListener("drop", e => {
          e.preventDefault(); if (dragI == null) return;
          let to = i + (row.classList.contains("drop-below") ? 1 : 0);
          const [x] = s.items.splice(dragI, 1); if (dragI < to) to--;
          s.items.splice(to, 0, x); dragI = null; drawItems(); changed();
        });
        row.append(handle, h("div", { class: "sl-cell c-name" }, nameIn, pick), numIn("qty", "Qty", { min: "0" }), h("label", { class: "sl-cell c-unit", dataset: { label: "Unit" } }, unitIn),
          numIn("price", "Price", { min: "0" }), numIn("discount", "Disc. %", { min: "0", max: "100" }), numIn("tax", "Tax %", { min: "0" }),
          h("div", { class: "sl-cell c-total", dataset: { label: "Total" } }, total),
          h("button", { type: "button", class: "icon-btn xs sl-del", title: "Remove", html: UI.icon("trash"), onclick: () => { s.items.splice(i, 1); drawItems(); changed(); } }));
        return row;
      }
      function drawItems() {
        rowsEl.replaceChildren(...s.items.map(itemRow));
        if (!s.items.length) rowsEl.append(h("div", { class: "sl-items-empty", text: "No items yet. Add a product from the catalog or a free row." }));
        drawTotals();
      }
      const addProd = h("button", { type: "button", class: "btn", text: "+ Add product" });
      addProd.onclick = () => productPicker(addProd, p => { s.items.push(applyProduct({ qty: 1, discount: 0 }, p)); drawItems(); changed(); });
      const addFree = h("button", { type: "button", class: "btn", text: "+ Free row", onclick: () => {
        const last = s.items[s.items.length - 1];
        s.items.push({ name: "", qty: 1, unit: "pcs", price: "", discount: 0, tax: last ? num(last.tax) : 0 });
        drawItems(); changed(); rowsEl.lastChild?.querySelector(".sl-in-name")?.focus();
      } });

      /* saving */
      async function persist() {
        s.number = String(s.number || "").trim();
        if (s.number && Data.list("quotes").some(x => x.id !== id && !x.deleted && x.kind === s.kind && (x.number || "") === s.number)
          && !await ask(`${s.number} is already used by another ${K.one}. Save with the same number?`, "Save anyway", "Number already used")) return null;
        const data = pack(s);
        if (!id) {
          if (data.number) bumpNumber(s.kind, data.number); else data.number = takeNumber(s.kind);
          s.number = data.number; numberIn.value = data.number;
          id = Data.uid(); Data.add("quotes", data, id);
        } else Data.update("quotes", id, data);
        snap = JSON.stringify(pack(s)); changed(); paintHead();
        return id;
      }
      async function doStatus(k) {
        if (k === "convert") {
          if (!await persist()) return;
          if (await convertEstimate(Data.get("quotes", id))) m.close(true);
          return;
        }
        const patch = statusPatch(s, k);
        Object.assign(s, patch);
        if (!await persist()) return;
        UI.toast(`${K.One} ${s.number} marked as ${stName(s.kind, k)}`);
        if (k === "paid") afterPaid({ ...pack(s), id });
      }
      async function doPrint() {
        const w = window.open("", "_blank");
        if (!w) return UI.toast("Allow pop-ups for Lumen to print or save as PDF");
        try { w.document.write("<p style='font:14px system-ui;padding:24px;color:#777'>Preparing document…</p>"); } catch {}
        if (!id || isDirty()) { if (!await persist()) { w.close(); return; } }
        writePrint(w, { ...pack(s), id });
      }
      const saveBtn = h("button", { class: "btn primary", type: "button", text: isNew ? "Create " + K.one : "Save", onclick: async () => {
        const wasNew = !id;
        if (await persist()) { UI.toast(wasNew ? `${K.icon} ${K.One} ${s.number} created` : `${K.One} ${s.number} saved`); m.close(true); }
      } });
      const delBtn = h("button", { class: "btn danger", type: "button", text: "Delete", onclick: async () => { if (id && await softDelete({ ...pack(s), id })) m.close(true); } });

      function paintHead() {
        titleEl.replaceChildren(h("b", { text: id ? `${K.One} ${s.number}` : "New " + K.one }), s.title ? h("small", { class: "sl-ell", text: s.title }) : null);
        const pb = h("button", { type: "button", class: "sl-pill-btn", title: "Change status" }, pill(s), h("span", { class: "sl-caret", text: "▾" }));
        pb.onclick = () => UI.menu(pb, Object.entries(STATUS[s.kind]).filter(([k]) => k !== "overdue").map(([k, [l, c]]) => ({
          iconHtml: `<span class="sl-dot" data-tc="${c}"></span>`, label: l, onClick: () => k !== s.status && doStatus(k) })));
        pillBox.replaceChildren(pb);
        const src = s.fromEstimate && Data.get("quotes", s.fromEstimate), conv = id && !isInv && converted({ id });
        actBox.replaceChildren(...statusActions(s).map(([label, k, cls]) => h("button", { type: "button", class: "btn " + (cls || ""), text: label, onclick: () => doStatus(k) })),
          h("span", { class: "grow" }),
          src ? h("button", { type: "button", class: "sl-link", text: "From estimate " + (src.number || ""), onclick: () => openQuote(src.id) }) : null,
          conv ? h("button", { type: "button", class: "sl-link", text: "Invoice " + (conv.number || ""), onclick: () => openQuote(conv.id) }) : null,
          dispStatus(s) === "overdue" ? h("span", { class: "sl-late", text: "Overdue since " + Apps.fmtDate(s.due) }) : null,
          s.status === "paid" && s.paidAt ? h("span", { class: "sl-paid-at", text: "Paid " + Apps.fmtDate(Apps.iso(new Date(s.paidAt))) }) : null);
        delBtn.style.display = id ? "" : "none";
      }

      const body = h("div", { class: "sl-m-body sl-q-body" },
        h("div", { class: "sl-q-grid" },
          h("div", { class: "sl-q-card" }, field("Title", titleIn, "full"), h("div", { class: "sl-sec", text: "Client" }), clientBox),
          h("div", { class: "sl-q-card sl-q-meta" }, field("Number", numberIn), field("Currency", curSel), field(isInv ? "Issue date" : "Date", issueIn),
            field(isInv ? "Due date" : "Valid until", dueIn), field("Responsible", ownerBtn, "full"))),
        h("div", { class: "sl-sec", text: "Products and services" }),
        h("div", { class: "sl-items" },
          h("div", { class: "sl-it head" }, h("span"), h("span", { text: "Item" }), h("span", { text: "Qty" }), h("span", { text: "Unit" }), h("span", { text: "Price" }),
            h("span", { text: "Disc. %" }), h("span", { text: "Tax %" }), h("span", { text: "Total" }), h("span")),
          rowsEl),
        h("div", { class: "sl-items-add" }, addProd, addFree),
        h("div", { class: "sl-q-bottom" },
          h("div", { class: "sl-q-notes" }, field("Notes", ta("notes", "Shown on the document, e.g. a thank-you note"), "full"), field("Terms", ta("terms", "Payment terms, delivery, warranty…"), "full")),
          totalsEl));
      m.el.append(
        mhead(h("div", { class: "sl-q-headl" }, h("span", { class: "sl-q-ic", text: K.icon }), titleEl, pillBox), m, printBtn, moreBtn),
        h("div", { class: "sl-q-actbar" }, actBox),
        body,
        h("div", { class: "sl-m-foot" }, delBtn, h("span", { class: "grow" }), h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => m.close() }), saveBtn));
      paintHead(); paintClient(); paintOwner(); drawItems(); changed();
      if (isNew && !s.title) setTimeout(() => titleIn.focus(), 80);
    });
  }

  function newQuote(o = {}) {
    const kind = o.kind === "estimate" ? "estimate" : "invoice";
    const d = o.deal && Data.get("deals", o.deal);
    const q = blankQuote(kind, { deal: o.deal || "", contact: o.contact || d?.contact || "", company: o.company || d?.company || "", title: o.title || d?.title || "",
      items: normItems(o.items || d?.products || []), owner: d?.owner || meKey() });
    if (!q.items.length && d && num(d.amount) > 0) q.items = [{ name: d.title || "Services", qty: 1, unit: "pcs", price: num(d.amount), discount: 0, tax: 0 }];
    return openEditor(q, true);
  }
  function openQuote(id) {
    const q = Data.get("quotes", id);
    if (!q) { UI.toast("That document is no longer available"); return Promise.resolve(null); }
    return openEditor({ ...clone(q), id }, false);
  }

  /* ---------- printable document ---------- */
  function printQuote(q) {
    const w = window.open("", "_blank");
    if (!w) return UI.toast("Allow pop-ups for Lumen to print or save as PDF");
    writePrint(w, q);
  }
  function writePrint(w, q) { w.document.open(); w.document.write(printHTML(q)); w.document.close(); }
  function printHTML(q) {
    const c = company(), cur = q.currency || defCur(), e = esc, F = v => e(fmt(v, cur)), t = totals(q.items), isInv = q.kind === "invoice", K = KIND[isInv ? "invoice" : "estimate"], st = dispStatus(q);
    let accent = ""; try { accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(); } catch {}
    if (!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(accent)) accent = "#7c5cff";
    const logo = fileData(c.logo);
    const comp = q.company && Data.get("companies", q.company), ct = q.contact && Data.get("contacts", q.contact), deal = q.deal && Data.get("deals", q.deal);
    const nl = s => e(s).replace(/\n/g, "<br>");
    const client = comp?.name || ct?.name || deal?.title || "—";
    const clientRows = [comp && ct?.name ? "Attn: " + ct.name : "", comp?.address || ct?.address || "", ct?.email || comp?.email || "", ct?.phone || comp?.phone || "", comp?.website || "", comp?.taxId ? "Tax ID: " + comp.taxId : ""].filter(Boolean);
    const sellerRows = [c.address, [c.phone, c.email].filter(Boolean).join(" · "), c.website, c.taxId ? "Tax ID: " + c.taxId : ""].filter(Boolean);
    const items = q.items || [], hasDisc = items.some(it => num(it.discount)), hasTax = items.some(it => num(it.tax));
    const taxes = {}; items.forEach(it => { const r = num(it.tax); if (r) taxes[r] = (taxes[r] || 0) + line(it).tax; });
    const rows = items.map((it, i) => {
      const l = line(it), p = it.product && Data.get("products", it.product);
      return `<tr><td class="n">${i + 1}</td><td><div class="iname">${e(it.name || "Item")}</div>${p?.sku ? `<div class="sub">SKU ${e(p.sku)}</div>` : ""}</td>`
        + `<td class="r">${e(qtyFmt(it.qty))}${it.unit ? " " + e(it.unit) : ""}</td><td class="r">${F(it.price)}</td>`
        + (hasDisc ? `<td class="r">${num(it.discount) ? e(qtyFmt(it.discount)) + "%" : "—"}</td>` : "")
        + (hasTax ? `<td class="r">${num(it.tax) ? e(qtyFmt(it.tax)) + "%" : "—"}</td>` : "")
        + `<td class="r b">${F(l.net)}</td></tr>`;
    }).join("");
    const cols = 5 + (hasDisc ? 1 : 0) + (hasTax ? 1 : 0);
    const meta = [[isInv ? "Invoice no." : "Estimate no.", q.number], [isInv ? "Issue date" : "Date", longDate(q.issue)], [isInv ? "Due date" : "Valid until", longDate(q.due)], ["Reference", deal?.title]].filter(r => r[1]);
    const stamp = isInv && st === "paid" ? `<div class="stamp">Paid${q.paidAt ? `<small>${e(longDate(Apps.iso(new Date(q.paidAt))))}</small>` : ""}</div>`
      : isInv && st === "cancelled" ? `<div class="stamp void">Void</div>`
      : !isInv && st === "accepted" ? `<div class="stamp">Accepted</div>` : "";
    const due = isInv ? (st === "paid" ? "Thank you for your payment" : q.due ? "Due " + longDate(q.due) : "") : q.due ? "Valid until " + longDate(q.due) : "";
    const notes = [q.notes ? ["Notes", q.notes] : null, q.terms ? ["Terms", q.terms] : null, isInv && c.bank ? ["Payment details", c.bank] : null].filter(Boolean);
    const docTitle = `${K.One} ${q.number || ""}${c.name ? " · " + c.name : ""}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(docTitle)}</title>
<style>
@page { size: A4; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; }
:root { --a: ${accent}; --ink: #1d2130; --mut: #6b7183; --line: #e6e8ef; }
html { background: #eceef4; }
body { margin: 0; font: 13px/1.5 "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 14px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 10px 16px; background: rgba(255,255,255,.88); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--mut); }
.bar button { font: inherit; font-weight: 600; background: var(--a); color: #fff; border: 0; border-radius: 9px; padding: 8px 18px; cursor: pointer; box-shadow: 0 6px 16px -6px var(--a); }
.paper { position: relative; width: 210mm; min-height: 297mm; margin: 26px auto; padding: 16mm 15mm 14mm; background: #fff; border-radius: 4px; box-shadow: 0 18px 50px -18px rgba(20,24,60,.35); overflow: hidden; display: flex; flex-direction: column; }
.paper::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 6px; background: var(--a); }
.top { display: flex; justify-content: space-between; gap: 28px; align-items: flex-start; }
.brand img { display: block; max-height: 64px; max-width: 220px; object-fit: contain; margin-bottom: 10px; }
.brand .name { font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
.muted { color: var(--mut); font-size: 12px; line-height: 1.55; }
.doc { text-align: right; }
.doc h1 { margin: 0; font-size: 30px; line-height: 1.1; letter-spacing: .1em; text-transform: uppercase; color: var(--a); font-weight: 800; }
.doc .no { font-size: 14px; font-weight: 650; margin-top: 4px; }
.meta { margin: 12px 0 0 auto; border-collapse: collapse; }
.meta td { padding: 2px 0 2px 18px; font-size: 12px; text-align: right; } .meta td:first-child { color: var(--mut); }
.parties { display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; margin: 26px 0 22px; padding-top: 20px; border-top: 1px solid var(--line); }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: #8a90a2; font-weight: 700; margin-bottom: 6px; }
.who { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
.amount { border-radius: 10px; padding: 14px 16px; background: color-mix(in srgb, var(--a) 8%, #fff); border: 1px solid color-mix(in srgb, var(--a) 22%, #fff); text-align: right; align-self: start; }
.amount .big { font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: var(--ink); }
.subject { font-size: 15px; font-weight: 650; margin: 0 0 12px; }
table.items { width: 100%; border-collapse: separate; border-spacing: 0; }
.items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #fff; background: var(--a); padding: 9px 10px; font-weight: 700; }
.items th:first-child { border-radius: 7px 0 0 7px; } .items th:last-child { border-radius: 0 7px 7px 0; }
.items td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.items tbody tr:nth-child(even) td { background: #fafbfd; }
.items .n { width: 30px; color: #8a90a2; } .items .r { text-align: right; white-space: nowrap; } .items .b { font-weight: 650; }
.items .iname { font-weight: 600; } .items .sub { color: #8a90a2; font-size: 11px; }
.items .empty { text-align: center; color: #8a90a2; padding: 22px; }
tr { page-break-inside: avoid; break-inside: avoid; }
.sum { display: flex; justify-content: flex-end; margin-top: 16px; page-break-inside: avoid; }
.sum table { width: 300px; border-collapse: collapse; }
.sum td { padding: 5px 10px; } .sum td:last-child { text-align: right; white-space: nowrap; font-weight: 600; }
.sum .total td { font-size: 16px; font-weight: 800; border-top: 2px solid var(--ink); padding-top: 10px; }
.sum .total td:last-child { color: var(--a); }
.notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 22px; margin-top: 30px; page-break-inside: avoid; }
.notes p { margin: 0; color: #3b4152; font-size: 12px; white-space: normal; }
.foot { margin-top: auto; padding-top: 28px; }
.foot div { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 10px; color: #8a90a2; font-size: 10.5px; }
.stamp { position: absolute; top: 46mm; right: 22mm; transform: rotate(-14deg); border: 4px solid #16a34a; color: #16a34a; font-size: 38px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; padding: 4px 18px 6px; border-radius: 12px; opacity: .78; text-align: center; line-height: 1.1; pointer-events: none; }
.stamp small { display: block; font-size: 11px; letter-spacing: .08em; font-weight: 700; }
.stamp.void { border-color: #d44c47; color: #d44c47; }
@media print { html, body { background: #fff; } .bar { display: none; } .paper { width: auto; min-height: calc(297mm - 30mm); margin: 0; padding: 0; box-shadow: none; border-radius: 0; } .paper::before { display: none; } .stamp { top: 30mm; right: 8mm; } }
@media screen and (max-width: 820px) { .paper { width: auto; min-height: 0; margin: 12px; padding: 22px 18px; } .parties, .top { grid-template-columns: 1fr; flex-direction: column; } .doc { text-align: left; } .meta { margin-left: 0; } .meta td { text-align: left; padding: 2px 18px 2px 0; } .items { font-size: 12px; } }
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">Print / Save as PDF</button><span>To get a PDF, choose “Save as PDF” as the printer.</span></div>
<main class="paper">
${stamp}
<header class="top">
  <div class="brand">${logo ? `<img src="${e(logo)}" alt="">` : ""}<div class="name">${e(c.name || "Your company")}</div><div class="muted">${sellerRows.map(nl).join("<br>")}</div></div>
  <div class="doc"><h1>${isInv ? "Invoice" : "Estimate"}</h1><div class="no">${e(q.number || "")}</div><table class="meta">${meta.map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join("")}</table></div>
</header>
<section class="parties">
  <div><div class="label">${isInv ? "Bill to" : "Prepared for"}</div><div class="who">${e(client)}</div><div class="muted">${clientRows.map(nl).join("<br>")}</div></div>
  <div class="amount"><div class="label">${isInv ? (st === "paid" ? "Amount paid" : "Amount due") : "Estimate total"}</div><div class="big">${F(t.total)}</div>${due ? `<div class="muted">${e(due)}</div>` : ""}</div>
</section>
${q.title ? `<h2 class="subject">${e(q.title)}</h2>` : ""}
<table class="items"><thead><tr><th class="n">#</th><th>Description</th><th class="r">Qty</th><th class="r">Price</th>${hasDisc ? '<th class="r">Disc.</th>' : ""}${hasTax ? '<th class="r">Tax</th>' : ""}<th class="r">Amount</th></tr></thead>
<tbody>${rows || `<tr><td colspan="${cols}" class="empty">No items</td></tr>`}</tbody></table>
<div class="sum"><table>
<tr><td>Subtotal</td><td>${F(t.subtotal)}</td></tr>
${t.discount ? `<tr><td>Discount</td><td>−${F(t.discount)}</td></tr>` : ""}
${Object.keys(taxes).length ? Object.entries(taxes).sort((a, b) => a[0] - b[0]).map(([r, v]) => `<tr><td>Tax ${e(qtyFmt(r))}%</td><td>${F(v)}</td></tr>`).join("") : `<tr><td>Tax</td><td>${F(0)}</td></tr>`}
<tr class="total"><td>Total</td><td>${F(t.total)}</td></tr>
</table></div>
${notes.length ? `<section class="notes">${notes.map(([l, v]) => `<div><div class="label">${e(l)}</div><p>${nl(v)}</p></div>`).join("")}</section>` : ""}
<footer class="foot"><div><span>${e([c.name, c.website, c.email].filter(Boolean).join(" · "))}</span><span>${e(K.One)} ${e(q.number || "")} · ${F(t.total)}</span></div></footer>
</main>
<script>addEventListener("load", function () { setTimeout(function () { window.focus(); window.print(); }, 350); });<\/script>
</body></html>`;
  }

  /* ---------- estimates / invoices lists ---------- */
  function inPeriod(d, p) {
    if (!p) return true; if (!d) return false;
    const x = new Date(d + "T00:00"), now = new Date();
    if (p === "month") return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth();
    if (p === "last") { const l = new Date(now.getFullYear(), now.getMonth() - 1, 1); return x.getFullYear() === l.getFullYear() && x.getMonth() === l.getMonth(); }
    if (p === "quarter") return x.getFullYear() === now.getFullYear() && Math.floor(x.getMonth() / 3) === Math.floor(now.getMonth() / 3);
    if (p === "year") return x.getFullYear() === now.getFullYear();
    return true;
  }
  function rowMenu(anchor, q) {
    const acts = statusActions(q).map(([label, k]) => ({ label, iconHtml: k === "paid" ? "💰" : k === "sent" ? "📤" : k === "convert" ? "🧾" : k === "accepted" ? "✅" : k === "declined" ? "✖️" : k === "cancelled" ? "🚫" : "↩️",
      onClick: () => k === "convert" ? convertEstimate(q) : quickStatus(q, k) }));
    UI.menu(anchor, [...acts, acts.length ? { sep: true } : null,
      { label: "Open", icon: "page", onClick: () => openQuote(q.id) },
      { label: "Print / Save as PDF", icon: "download", onClick: () => printQuote(q) },
      { label: "Duplicate", icon: "copy", onClick: () => duplicate(q) },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, onClick: () => softDelete(q) }], { align: "end" });
  }
  function renderQuotes(root, kind) {
    const isInv = kind === "invoice", K = KIND[kind];
    let q = "", st = "", period = "", sortK = "issue", dir = -1, raf = 0;
    const cards = h("div", { class: "sl-cards" });
    const search = h("input", { class: "app-search", type: "search", placeholder: `Search ${K.one}s…`, oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); } });
    const stOpts = isInv ? [["", "All statuses"], ["unpaid", "Unpaid"], ["draft", "Draft"], ["sent", "Sent"], ["overdue", "Overdue"], ["paid", "Paid"], ["cancelled", "Cancelled"]]
      : [["", "All statuses"], ["open", "Open"], ["draft", "Draft"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"]];
    const stSel = select(stOpts, st, v => { st = v; draw(); });
    const perSel = select([["", "Any time"], ["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["year", "This year"]], period, v => { period = v; draw(); });
    const setSt = v => { st = st === v ? "" : v; stSel.value = st; draw(); };
    const body = h("div", { class: "sl-qbody" });
    root.append(h("div", { class: "sl-wrap" }, cards,
      h("div", { class: "app-toolbar sl-toolbar" }, search, stSel, perSel, h("span", { class: "grow" }),
        h("button", { class: "btn", text: "🏢 Company details", title: "Your business details, logo and numbering", onclick: () => settings() }),
        h("button", { class: "btn primary", text: "+ New " + K.one, onclick: () => newQuote({ kind }) })),
      body));

    const multi = list => moneyMulti(sumBy(list));
    function drawCards(all) {
      const now = new Date(), mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const kpi = (label, value, sub, tone, key, i) => h("button", { type: "button", class: "sl-kpi glass" + (tone ? " " + tone : "") + (key && st === key ? " on" : ""), style: { animationDelay: i * 50 + "ms" }, onclick: key ? () => setSt(key) : null },
        h("span", { text: label }), h("b", { text: value }), h("small", { text: sub }));
      if (isInv) {
        const unpaid = all.filter(x => ["sent", "overdue"].includes(dispStatus(x))), over = all.filter(x => dispStatus(x) === "overdue");
        const paid = all.filter(x => x.status === "paid" && (x.paidAt || 0) >= mStart), drafts = all.filter(x => (x.status || "draft") === "draft");
        cards.replaceChildren(kpi("Unpaid", multi(unpaid), plural(unpaid.length, "invoice"), "", "unpaid", 0), kpi("Overdue", multi(over), plural(over.length, "invoice"), over.length ? "bad" : "", "overdue", 1),
          kpi("Paid this month", multi(paid), plural(paid.length, "invoice"), "good", "paid", 2), kpi("Drafts", multi(drafts), plural(drafts.length, "draft"), "", "draft", 3));
      } else {
        const open = all.filter(x => ["draft", "sent"].includes(x.status || "draft")), acc = all.filter(x => x.status === "accepted"), dec = all.filter(x => x.status === "declined");
        const accM = acc.filter(x => (x.acceptedAt || x.at || 0) >= mStart), conv = all.filter(x => converted(x)).length;
        const rate = acc.length + dec.length ? Math.round(acc.length / (acc.length + dec.length) * 100) + "%" : "—";
        cards.replaceChildren(kpi("Open value", multi(open), plural(open.length, "estimate"), "", "open", 0), kpi("Accepted this month", multi(accM), plural(accM.length, "estimate"), "good", "accepted", 1),
          kpi("Acceptance rate", rate, `${acc.length} accepted · ${dec.length} declined`, "", null, 2), kpi("Converted", String(conv), conv === 1 ? "turned into an invoice" : "turned into invoices", "", null, 3));
      }
    }
    const COLS = [["number", "Number", "minmax(96px,.8fr)"], ["client", "Client", "minmax(120px,1.2fr)"], ["title", "Title", "minmax(120px,1.4fr)"], ["amount", "Amount", "minmax(104px,.9fr)"],
      ["status", "Status", "104px"], ["issue", isInv ? "Issued" : "Date", "80px"], ["due", isInv ? "Due" : "Valid until", "92px"], ["owner", "Responsible", "minmax(120px,1fr)"], ["more", "", "34px"]];
    const gridCols = COLS.map(c => c[2]).join(" ");
    const val = (x, k) => k === "amount" ? totals(x.items).total : k === "client" ? clientName(x) : k === "status" ? dispStatus(x) : k === "owner" ? Data.person(x.owner || x.by).name : (x[k] || "");
    const matches = x => {
      const ds = dispStatus(x);
      if (st === "unpaid" ? !(ds === "sent" || ds === "overdue") : st === "open" ? !(ds === "draft" || ds === "sent") : st && ds !== st) return false;
      if (!inPeriod(x.issue, period)) return false;
      return !q || `${x.number} ${x.title} ${clientName(x)} ${Data.person(x.owner || x.by).name}`.toLowerCase().includes(q);
    };
    function quoteRow(x, i) {
      const ds = dispStatus(x), conv = !isInv && converted(x), src = x.fromEstimate && Data.get("quotes", x.fromEstimate);
      const more = h("button", { type: "button", class: "icon-btn xs sl-more", title: "Actions", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); rowMenu(more, x); } });
      return h("div", { class: "sl-tr", role: "button", tabindex: 0, style: { "--cols": gridCols, animationDelay: Math.min(i, 14) * 18 + "ms" }, onclick: () => openQuote(x.id), onkeydown: e => { if (e.key === "Enter" && e.target === e.currentTarget) openQuote(x.id); } },
        h("span", { class: "c-number" }, h("b", { text: x.number || "—" }), conv ? h("small", { text: "→ " + (conv.number || "invoice") }) : src ? h("small", { text: "from " + (src.number || "estimate") }) : null),
        h("span", { class: "c-client sl-ell", text: clientName(x) }),
        h("span", { class: "c-title sl-ell", text: x.title || "" }),
        h("span", { class: "c-amount", text: fmt(totals(x.items).total, x.currency) }),
        h("span", { class: "c-status" }, pill(x)),
        h("span", { class: "c-issue", dataset: { label: isInv ? "Issued" : "Date" }, text: Apps.fmtDate(x.issue) }),
        h("span", { class: "c-due" + (ds === "overdue" ? " late" : ""), dataset: { label: isInv ? "Due" : "Valid until" }, text: Apps.fmtDate(x.due) }),
        h("span", { class: "c-owner" }, who(x.owner || x.by)),
        more);
    }
    function draw() {
      const all = live("quotes").filter(x => x.kind === kind);
      drawCards(all);
      if (!all.length) return body.replaceChildren(Apps.empty(K.icon, isInv ? "No invoices yet. Create one here or from a deal." : "No estimates yet. Send a client a quote in a couple of clicks.",
        h("button", { class: "btn primary", text: "+ New " + K.one, onclick: () => newQuote({ kind }) })));
      const rows = all.filter(matches).sort((a, b) => {
        const A = val(a, sortK), B = val(b, sortK);
        return (typeof A === "number" ? A - B : String(A).localeCompare(String(B), undefined, { numeric: true })) * dir || (b.at || 0) - (a.at || 0);
      });
      const headRow = h("div", { class: "sl-tr head", style: { "--cols": gridCols } }, ...COLS.map(([k, l]) => k === "more" ? h("span") :
        h("button", { type: "button", class: "sl-th c-" + k + (sortK === k ? " on" : ""), onclick: () => { if (sortK === k) dir = -dir; else { sortK = k; dir = ["amount", "issue", "due", "number"].includes(k) ? -1 : 1; } draw(); } },
          l, sortK === k ? h("span", { class: "sl-sort", text: dir > 0 ? "↑" : "↓" }) : null)));
      body.replaceChildren(h("div", { class: "sl-table sl-qtable glass" }, headRow, ...rows.map(quoteRow), !rows.length ? h("div", { class: "sl-none", text: "Nothing matches these filters." }) : null),
        rows.length ? h("div", { class: "sl-table-foot" }, h("span", { text: plural(rows.length, K.one) }), h("b", { text: multi(rows) })) : null);
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    const offs = ["quotes", "deals", "contacts", "companies", "settings"].map(c => Data.on(c, schedule));
    const tick = setInterval(schedule, 3600000); // a new day can make invoices overdue
    draw();
    return () => { cancelAnimationFrame(raf); clearInterval(tick); offs.forEach(f => f()); };
  }

  /* ---------- products inside the CRM deal panel ---------- */
  const pendingDeals = {}; // deal id → { items, timer, flush } while a save is waiting
  const dealItem = it => ({ ...(it.product ? { product: it.product } : {}), name: String(it.name || "").trim(), qty: num(it.qty), price: num(it.price), discount: Math.min(100, Math.max(0, num(it.discount))), tax: num(it.tax) });
  function dealProducts(container, deal) {
    if (!container || !deal || !deal.id) return;
    const did = deal.id, cur = Apps.currency(), F = v => fmt(v, cur);
    let items = pendingDeals[did] ? pendingDeals[did].items : normItems(deal.products || []);
    container.classList.add("sl-dp");
    function queue(now) {
      const p = pendingDeals[did] || (pendingDeals[did] = {});
      p.items = items; clearTimeout(p.timer);
      p.flush = () => {
        clearTimeout(p.timer);
        if (pendingDeals[did] !== p) return;
        delete pendingDeals[did];
        const list = items.filter(filled).map(dealItem), patch = { products: list };
        if (list.length) patch.amount = totals(list).total;
        Data.update("deals", did, patch);
      };
      if (now) p.flush(); else p.timer = setTimeout(p.flush, 800);
    }
    container._slFlush = () => pendingDeals[did]?.flush?.();
    if (!container._slBound) {
      container._slBound = true;
      container.addEventListener("focusout", e => { if (!container.contains(e.relatedTarget)) setTimeout(() => container._slFlush?.(), 0); });
    }
    const focusLast = () => container.querySelector(".sl-dp-row:last-child .sl-in-name")?.focus();
    const addPicked = p => { items.push(applyProduct({ qty: 1, discount: 0 }, p)); draw(); queue(true); };
    const addFree = name => { const last = items[items.length - 1]; items.push({ name: name || "", qty: 1, price: "", discount: 0, tax: last ? num(last.tax) : 0 }); draw(); name ? queue(true) : focusLast(); };
    function draw() {
      if (!items.length) {
        const add = h("button", { type: "button", class: "btn sl-dp-add" }, h("span", { text: "📦" }), " Add products");
        add.onclick = () => productPicker(add, addPicked, { free: addFree });
        return container.replaceChildren(add);
      }
      const totalEl = h("b"), taxEl = h("small");
      const paintTotal = () => { const t = totals(items); totalEl.textContent = F(t.total); taxEl.textContent = t.tax ? "incl. tax " + F(t.tax) : ""; };
      const rows = items.map((it, i) => {
        const lt = h("span", { class: "sl-dp-lt", text: F(line(it).net) });
        const ni = (key, label, attrs = {}) => {
          const el = h("input", { class: "sl-in sl-num", type: "number", step: "any", inputmode: "decimal", "aria-label": label, min: "0", ...attrs });
          el.value = it[key] ?? "";
          el.oninput = () => { it[key] = el.value === "" ? "" : num(el.value); lt.textContent = F(line(it).net); paintTotal(); queue(); };
          return h("label", { class: "sl-cell c-" + key, dataset: { label } }, el);
        };
        const nameIn = h("input", { class: "sl-in sl-in-name", placeholder: "Product or service", "aria-label": "Product" });
        nameIn.value = it.name || ""; nameIn.oninput = () => { it.name = nameIn.value; queue(); };
        const prod = it.product && Data.get("products", it.product);
        const pick = h("button", { type: "button", class: "icon-btn xs sl-pick" + (prod ? " linked" : ""), title: prod ? "From catalog (pick another)" : "Pick from catalog", text: "📦" });
        pick.onclick = () => productPicker(pick, p => { applyProduct(it, p); draw(); queue(true); });
        return h("div", { class: "sl-dp-row" }, h("div", { class: "sl-cell c-name" }, nameIn, pick), ni("qty", "Qty"), ni("price", "Price"), ni("discount", "Disc. %", { max: "100" }), ni("tax", "Tax %"),
          h("div", { class: "sl-cell c-total", dataset: { label: "Total" } }, lt),
          h("button", { type: "button", class: "icon-btn xs sl-del", title: "Remove", html: UI.icon("trash"), onclick: () => { items.splice(i, 1); draw(); queue(true); } }));
      });
      const addP = h("button", { type: "button", class: "chip-btn", text: "+ Product" });
      addP.onclick = () => productPicker(addP, addPicked);
      container.replaceChildren(
        h("div", { class: "sl-dp-table" }, h("div", { class: "sl-dp-row head" }, ...["Product", "Qty", "Price", "Disc. %", "Tax %", "Total", ""].map(t => h("span", { text: t }))), ...rows),
        h("div", { class: "sl-dp-foot" }, addP, h("button", { type: "button", class: "chip-btn", text: "+ Free row", onclick: () => addFree("") }), h("span", { class: "grow" }),
          h("span", { class: "sl-dp-total" }, h("span", { text: "Total" }), totalEl, taxEl)));
      paintTotal();
    }
    draw();
  }

  /* ---------- company details (settings "company") ---------- */
  function settings() {
    return new Promise(resolve => {
      const v = { name: "", address: "", taxId: "", email: "", phone: "", website: "", logo: null, bank: "", invoiceNotes: "", estimateNotes: "", terms: "",
        estimatePrefix: "EST-", invoicePrefix: "INV-", nextEstimate: 1, nextInvoice: 1, currency: defCur(), ...clone(company()) };
      let done = false;
      const m = overlay("sl-set-modal", { onClose: () => !done && resolve(false) });
      const prevE = h("small", { class: "sl-hint" }), prevI = h("small", { class: "sl-hint" });
      const preview = () => {
        prevE.textContent = "Next estimate: " + (v.estimatePrefix ?? "") + pad(Math.max(1, parseInt(v.nextEstimate) || 1));
        prevI.textContent = "Next invoice: " + (v.invoicePrefix ?? "") + pad(Math.max(1, parseInt(v.nextInvoice) || 1));
      };
      const tin = (key, ph, attrs = {}) => { const el = h("input", { class: "menu-input", placeholder: ph || "", ...attrs }); el.value = v[key] ?? ""; el.oninput = () => { v[key] = el.value; preview(); }; return el; };
      const tta = (key, ph, rows = 3) => { const el = h("textarea", { class: "menu-input f-ta", rows, placeholder: ph || "" }); el.value = v[key] || ""; el.oninput = () => (v[key] = el.value); return el; };
      const logoBox = h("div", { class: "sl-logo" });
      function paintLogo() {
        const d = fileData(v.logo);
        const up = h("button", { type: "button", class: "btn", text: d ? "Change logo" : "Upload logo" });
        up.onclick = async () => {
          const [f] = await Apps.pickFiles(false); if (!f) return;
          if (!/^image\//.test(f.type)) return UI.toast("Pick an image file");
          up.disabled = true; up.textContent = "Uploading…";
          const [att] = await Apps.attach([await shrinkImage(f, 480)]);
          if (att) v.logo = att; paintLogo();
        };
        logoBox.replaceChildren(h("div", { class: "sl-logo-prev" }, d ? h("img", { src: d, alt: "Logo" }) : h("span", { text: "🏢" })),
          h("div", { class: "sl-logo-acts" }, up, d ? h("button", { type: "button", class: "btn danger", text: "Remove", onclick: () => { v.logo = null; paintLogo(); } }) : null,
            h("small", { class: "sl-hint", text: "PNG or JPG, shown at the top of your documents" })));
      }
      const curSel = select(uniq([v.currency, Apps.currency(), ...CURRENCIES]).map(c => [c, c]), v.currency, x => (v.currency = x), "menu-input");
      const save = () => {
        const s = x => String(x ?? "").trim();
        const patch = { name: s(v.name), address: s(v.address), taxId: s(v.taxId), email: s(v.email), phone: s(v.phone), website: s(v.website), logo: v.logo || null, bank: s(v.bank),
          invoiceNotes: s(v.invoiceNotes), estimateNotes: s(v.estimateNotes), terms: s(v.terms), currency: v.currency || Apps.currency(),
          estimatePrefix: String(v.estimatePrefix ?? ""), invoicePrefix: String(v.invoicePrefix ?? ""),
          nextEstimate: Math.max(1, parseInt(v.nextEstimate) || 1), nextInvoice: Math.max(1, parseInt(v.nextInvoice) || 1) };
        Data.update("settings", "company", patch);
        done = true; m.close(true); UI.toast("🏢 Company details saved"); resolve(true);
      };
      const numA = { type: "number", min: "1", step: "1", inputmode: "numeric" };
      m.el.append(mhead("Company details", m),
        h("div", { class: "sl-m-body" },
          h("p", { class: "sl-intro", text: "Printed on every estimate and invoice." }),
          h("div", { class: "sl-sec", text: "Business" }),
          h("div", { class: "sl-grid" }, field("Business name", tin("name", "Acme Studio"), "full"), field("Address", tta("address", "Street, city, postcode, country", 2), "full"),
            field("Tax ID", tin("taxId", "VAT / GST number"), "half"), field("Email", tin("email", "billing@example.com", { type: "email" }), "half"),
            field("Phone", tin("phone", "", { type: "tel" }), "half"), field("Website", tin("website", "example.com"), "half"),
            h("div", { class: "sl-f full" }, h("span", { text: "Logo" }), logoBox)),
          h("div", { class: "sl-sec", text: "Payment" }),
          h("div", { class: "sl-grid" }, field("Bank details", tta("bank", "Bank, account name, IBAN / account no., SWIFT / IFSC", 3), "full"), field("Default currency", curSel, "half")),
          h("div", { class: "sl-sec", text: "Default texts" }),
          h("div", { class: "sl-grid" }, field("Invoice notes", tta("invoiceNotes", "e.g. Thank you for your business!", 2), "full"), field("Estimate notes", tta("estimateNotes", "e.g. We look forward to working with you.", 2), "full"),
            field("Terms", tta("terms", "e.g. Payment within 14 days by bank transfer.", 2), "full")),
          h("div", { class: "sl-sec", text: "Numbering" }),
          h("div", { class: "sl-grid" }, field("Estimate prefix", tin("estimatePrefix", "EST-"), "half"), field("Next estimate number", tin("nextEstimate", "1", numA), "half"),
            field("Invoice prefix", tin("invoicePrefix", "INV-"), "half"), field("Next invoice number", tin("nextInvoice", "1", numA), "half"),
            h("div", { class: "sl-f full sl-previews" }, prevE, prevI))),
        h("div", { class: "sl-m-foot" }, h("span", { class: "grow" }), h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { class: "btn primary", text: "Save", onclick: save })));
      paintLogo(); preview();
    });
  }

  /* ---------- entry point for the CRM tabs ---------- */
  function render(root, tab) {
    root.classList.add("sl-root");
    if (tab === "estimates" || tab === "estimate") return renderQuotes(root, "estimate");
    if (tab === "invoices" || tab === "invoice") return renderQuotes(root, "invoice");
    return renderProducts(root);
  }

  Apps.Sales = { render, editProduct, productPicker, openQuote, newQuote, dealProducts, totals, settings,
    // extras other apps may find handy
    fmt, printQuote, convertEstimate, statusOf: dispStatus, lineTotal: it => r2(line(it).net) };
})();
