/* CRM web forms (like Bitrix24 "CRM forms"): a builder with live preview, a public link / QR code / embed code,
   and every answer sent from the public page (form.html + js/form-public.js) turned into a CRM lead or deal.
   Shown as a CRM tab: Apps.Forms.render(root). Registers no sidebar app. */
(function () {
  const { h, esc, icon } = UI;

  const TYPES = [["text", "Short text"], ["email", "Email"], ["tel", "Phone"], ["textarea", "Long text"], ["select", "Dropdown"], ["checkbox", "Checkbox"]];
  const TYPE_IC = { text: "Aa", email: "@", tel: "☎", textarea: "¶", select: "▾", checkbox: "☑" };
  const MAPS = [["name", "Name"], ["companyName", "Company"], ["email", "Email"], ["phone", "Phone"], ["notes", "Notes"], ["extra", "Extra (added to notes)"]];
  const mapName = k => k === "extra" ? "Notes (extra)" : (MAPS.find(m => m[0] === k) || MAPS[5])[1];
  const typeName = k => (TYPES.find(t => t[0] === k) || TYPES[0])[1];
  const MAX_FIELDS = 40; // the public rules accept at most 40 answers per submission
  const uid = () => Math.random().toString(36).slice(2, 8);
  const shared = () => !!(window.Cloud?.ws && window.Cloud?.user);
  const siteBase = () => location.origin + location.pathname.replace(/[^/]*$/, ""); // drops index.html
  const linkFor = id => `${siteBase()}form.html?ws=${encodeURIComponent(Cloud.ws.id)}&f=${encodeURIComponent(id)}`;
  const embedFor = (id, title) => `<iframe src="${linkFor(id)}" title="${esc(title || "Contact form")}" style="width:100%;border:0;height:620px"></iframe>`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CHECK = `<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`;

  /* ---------- form docs ---------- */
  const guessMap = x => x.type === "email" ? "email" : x.type === "tel" ? "phone" : /company/i.test(x.label || "") ? "companyName" : /name/i.test(x.label || x.key || "") ? "name" : "extra";
  function norm(f) {
    f = f || {};
    return { ...f, name: f.name || "Untitled form", title: f.title ?? "", desc: f.desc || "", button: f.button || "Send", thanks: f.thanks || "",
      target: f.target === "deal" ? "deal" : "lead", owner: f.owner || f.createdBy || "", createdBy: f.createdBy || "", published: !!f.published,
      fields: (Array.isArray(f.fields) ? f.fields : []).filter(Boolean).map(x => ({ key: String(x.key || "f" + uid()), label: x.label || "", type: TYPES.some(t => t[0] === x.type) ? x.type : "text",
        required: !!x.required, placeholder: x.placeholder || "", options: Array.isArray(x.options) ? x.options.map(String) : [], map: MAPS.some(m => m[0] === x.map) ? x.map : guessMap(x) })) };
  }
  function blank() {
    return { name: "Website contact form", title: "Get in touch", desc: "Leave your details and we'll get back to you soon.",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "Your name", map: "name" },
        { key: "email", label: "Email", type: "email", required: false, placeholder: "you@example.com", map: "email" },
        { key: "phone", label: "Phone", type: "tel", required: false, placeholder: "+1 555 123 4567", map: "phone" },
        { key: "message", label: "Message", type: "textarea", required: false, placeholder: "How can we help?", map: "notes" }],
      button: "Send", thanks: "Thanks! We got your message and will be in touch soon.", target: "lead", owner: Data.me().key, createdBy: Data.me().key, published: true };
  }
  /* Storage is split in two, because anyone with the link can read a published forms doc:
     - forms/{id}: only what visitors need (no names, no emails); by is "form" so no member email lands there
     - settings/forms: { [formId]: { name, owner, target, map: { fieldKey: leadField }, createdBy } }, members only */
  const META_ID = "forms";
  const metaAll = () => Data.get("settings", META_ID) || {};
  const metaOf = id => { const m = metaAll()[id]; return m && typeof m === "object" ? m : {}; };
  // public doc + private settings -> the shape the builder works with (falls back to old docs that still carry owner/by/name/target/map)
  function full(doc) {
    doc = doc || {};
    const m = metaOf(doc.id), map = m.map && typeof m.map === "object" ? m.map : {};
    const legacyBy = doc.by && doc.by !== "form" ? doc.by : "";
    return norm({ ...doc, name: m.name ?? doc.name, owner: m.owner || doc.owner || "", target: m.target || doc.target, createdBy: m.createdBy || legacyBy,
      fields: (Array.isArray(doc.fields) ? doc.fields : []).filter(Boolean).map(x => ({ ...x, map: map[x.key] ?? x.map })) });
  }
  const publicDoc = f => {
    const d = { title: f.title.trim(), desc: f.desc.trim(), button: f.button.trim() || "Send", thanks: f.thanks.trim(), published: !!f.published, by: "form",
      fields: f.fields.slice(0, MAX_FIELDS).map(x => {
        const o = { key: x.key, label: x.label.trim() || "Untitled field", type: x.type, required: !!x.required, placeholder: (x.placeholder || "").trim() };
        if (x.type === "select") o.options = x.options.map(v => String(v).trim()).filter(Boolean).slice(0, 50);
        return o;
      }) };
    if (f.at) d.at = f.at;
    return d;
  };
  const metaDoc = f => ({ name: f.name.trim() || "Untitled form", owner: f.owner || Data.me().key, target: f.target === "deal" ? "deal" : "lead",
    map: Object.fromEntries(f.fields.slice(0, MAX_FIELDS).map(x => [x.key, x.map || "extra"])), createdBy: f.createdBy || Data.me().key });
  // Data.add with an id overwrites the whole doc, which also drops fields an older version stored there
  async function saveForm(f, id) {
    id = id || Data.uid();
    await Data.update("settings", META_ID, { [id]: metaDoc(f) }); // private part first, so new answers find their owner
    await Data.add("forms", publicDoc(f), id);
    return id;
  }
  // forms made before the split still carry owner/by/name/target/map in the public doc: re-save them clean
  const isLegacy = d => d.owner !== undefined || d.name !== undefined || d.target !== undefined || (d.by && d.by !== "form") || (Array.isArray(d.fields) && d.fields.some(x => x && x.map !== undefined));
  const migrating = new Set();
  function migrate() {
    Data.list("forms").filter(d => !migrating.has(d.id) && isLegacy(d)).forEach(d => {
      migrating.add(d.id);
      saveForm(full(d), d.id).catch(e => console.warn("Form migration", d.id, e));
    });
  }
  const liveForms = () => Data.list("forms").filter(f => !f.deleted).map(full).sort((a, b) => (b.at || 0) - (a.at || 0));
  function stats(id) {
    const ls = Data.list("leads").filter(l => l.form === id && !l.deleted), ds = Data.list("deals").filter(d => d.form === id && !d.deleted);
    return { leads: ls.length, deals: ds.length, last: Math.max(0, ...ls.map(x => x.at || 0), ...ds.map(x => x.at || 0)) };
  }

  /* ---------- validation (same rules as the public page) ---------- */
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function problem(fd, v) {
    if (fd.type === "checkbox") return fd.required && !v ? "Please tick this box" : "";
    v = String(v || "").trim();
    if (!v) return fd.required ? (fd.type === "select" ? "Please choose an option" : "Please fill this in") : "";
    if (fd.type === "email" && !EMAIL.test(v)) return "Enter a valid email, like name@example.com";
    if (fd.type === "tel" && (!/^[+()\-.\s\d]+$/.test(v) || v.replace(/\D/g, "").length < 5)) return "Enter a valid phone number";
    return "";
  }

  /* ---------- small helpers ---------- */
  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const ta = h("textarea", { style: { position: "fixed", top: "0", left: "0", opacity: "0" } }); ta.value = text; document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = ok ? "✓ Copied" : "Couldn't copy";
      clearTimeout(btn._t); btn._t = setTimeout(() => (btn.textContent = btn.dataset.label), 1600);
    }
    return ok;
  }
  function localNote() {
    const btn = h("button", { class: "btn primary", type: "button", text: "Create a shared workspace", onclick: () => window.Cloud?.share?.(btn) });
    return h("div", { class: "fm-note glass" }, h("span", { class: "fm-note-ic", text: "🔒" }),
      h("div", { class: "fm-note-t" }, h("b", { text: "Create a shared workspace to share forms" }),
        h("p", { text: "Forms in your private workspace live only in this browser, so visitors can't open them. In a shared workspace every form gets a public link, a QR code and embed code, and answers arrive as leads for your team." })),
      btn);
  }
  function localModal() { const m = UI.modal("Share a form", localNote(), { className: "fm-small" }); return m; }
  const slug = s => String(s || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  function downloadQr(name, link) {
    const svg = QR.svg(link, 1024); if (!svg) return;
    const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = h("a", { href: u, download: slug(name) + "-qr.svg" }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  }

  /* ---------- preview card (looks like the public page) ---------- */
  function previewCard(f, opts = {}) {
    const card = h("div", { class: "fm-pv-card" });
    const done = note => card.replaceChildren(h("div", { class: "fm-pv-done" }, h("div", { class: "fm-pv-check", html: CHECK }),
      h("p", { class: "fm-pv-thanks", text: f.thanks || "Thanks! We'll be in touch soon." }),
      note ? h("small", { class: "fm-pv-note", text: note }) : null,
      note ? h("button", { class: "fm-pv-again", type: "button", text: "Fill it in again", onclick: () => card.replaceWith(previewCard(f, opts)) }) : null));
    if (opts.mode === "thanks") { done(""); return card; }
    const ctls = {}, errs = {};
    const form = h("form", { class: "fm-pv-form", novalidate: true });
    f.fields.forEach(fd => {
      const id = "fmpv-" + uid() + "-" + fd.key.replace(/[^\w-]/g, ""), eid = id + "-err";
      let ctl;
      if (fd.type === "textarea") ctl = h("textarea", { id, rows: 3, placeholder: fd.placeholder || "", "aria-describedby": eid });
      else if (fd.type === "select") ctl = h("select", { id, "aria-describedby": eid }, h("option", { value: "", text: fd.placeholder || "Choose…" }), ...fd.options.filter(Boolean).map(o => h("option", { value: o, text: o })));
      else if (fd.type === "checkbox") ctl = h("input", { id, type: "checkbox", "aria-describedby": eid });
      else ctl = h("input", { id, type: fd.type, placeholder: fd.placeholder || "", "aria-describedby": eid, autocomplete: fd.map === "name" ? "name" : fd.type === "email" ? "email" : fd.type === "tel" ? "tel" : fd.map === "companyName" ? "organization" : "off" });
      if (fd.required) ctl.setAttribute("aria-required", "true");
      ctls[fd.key] = ctl; errs[fd.key] = h("div", { class: "fm-pv-err", id: eid });
      const star = fd.required ? h("span", { class: "fm-pv-star", "aria-hidden": "true", text: " *" }) : null;
      const clear = () => { if (ctl.getAttribute("aria-invalid") === "true" && !problem(fd, fd.type === "checkbox" ? ctl.checked : ctl.value)) { ctl.removeAttribute("aria-invalid"); errs[fd.key].textContent = ""; } };
      ctl.addEventListener("input", clear); ctl.addEventListener("change", clear);
      form.append(fd.type === "checkbox"
        ? h("div", { class: "fm-pv-row" }, h("label", { class: "fm-pv-check-row", for: id }, ctl, h("span", null, fd.label || "Untitled field", star)), errs[fd.key])
        : h("div", { class: "fm-pv-row" }, h("label", { for: id }, fd.label || "Untitled field", star), ctl, errs[fd.key]));
    });
    if (!f.fields.length) form.append(h("div", { class: "fm-pv-empty", text: "Add a field to see it here." }));
    form.append(h("button", { class: "fm-pv-btn", type: "submit", text: f.button || "Send" }));
    form.addEventListener("submit", e => {
      e.preventDefault();
      let first = null;
      f.fields.forEach(fd => {
        const c = ctls[fd.key], msg = problem(fd, fd.type === "checkbox" ? c.checked : c.value);
        errs[fd.key].textContent = msg;
        if (msg) { c.setAttribute("aria-invalid", "true"); first ||= c; } else c.removeAttribute("aria-invalid");
      });
      if (first) return first.focus();
      done("This is a preview: nothing was sent.");
    });
    card.append(f.title ? h("h2", { class: "fm-pv-title", text: f.title }) : null, f.desc ? h("p", { class: "fm-pv-desc", text: f.desc }) : null, form,
      h("div", { class: "fm-pv-foot" }, h("img", { src: "assets/logo.svg", alt: "" }), "Made with Lumen"));
    return card;
  }
  function openPreview(f) {
    const bar = h("div", { class: "fm-pv-bar" }, h("span", { text: "Try it out. Nothing is sent from the preview." }),
      shared() && f.published ? h("a", { class: "btn", href: linkFor(f.id), target: "_blank", rel: "noopener", text: "Open public page ↗" }) : null);
    UI.modal("Preview · " + f.name, h("div", null, bar, h("div", { class: "fm-stage big" }, previewCard(f))), { className: "fm-pvmodal" });
  }

  /* ---------- sharing: link, QR code, embed code ---------- */
  function shareView(f, opts = {}) {
    if (!shared()) return localNote();
    if (!f.id) return h("div", { class: "fm-share-empty" }, h("div", { class: "fm-share-ic", text: "🔗" }),
      h("p", { text: "Save the form to get its link, QR code and embed code." }),
      opts.onSave ? h("button", { class: "btn primary", type: "button", text: "Save now", onclick: opts.onSave }) : null);
    const link = linkFor(f.id), code = embedFor(f.id, f.title || f.name), svg = QR.svg(link, 220);
    const linkIn = h("input", { class: "menu-input", readonly: true, value: link, "aria-label": "Form link", onclick: e => e.target.select() });
    const codeIn = h("textarea", { class: "menu-input fm-code", readonly: true, rows: 3, "aria-label": "Embed code", onclick: e => e.target.select() }); codeIn.value = code;
    return h("div", { class: "fm-share" },
      !f.published ? h("div", { class: "fm-warn" }, h("span", { text: "This form is a draft, so its link says it isn't available. Publish it to start collecting answers." }),
        opts.onPublish ? h("button", { class: "btn primary", type: "button", text: "Publish", onclick: opts.onPublish }) : null) : null,
      h("div", { class: "fm-sec-t", text: "Link" }),
      h("div", { class: "fm-linkrow" }, linkIn, h("button", { class: "btn primary", type: "button", text: "Copy link", onclick: e => copy(link, e.currentTarget) }),
        h("a", { class: "btn", href: link, target: "_blank", rel: "noopener", text: "Open ↗" })),
      h("div", { class: "fm-qr-row" },
        svg ? h("div", { class: "fm-qr", html: svg }) : h("div", { class: "fm-qr none", text: "Link too long for a QR code" }),
        h("div", { class: "fm-qr-t" }, h("b", { text: "QR code" }), h("p", { text: "Point a phone camera at it to open the form. Print it on flyers, menus, receipts or business cards." }),
          svg ? h("button", { class: "btn", type: "button", text: "⬇ Download QR code", onclick: () => downloadQr(f.name, link) }) : null)),
      h("div", { class: "fm-sec-t", text: "Embed on your website" }), codeIn,
      h("div", { class: "fm-row-end" }, h("small", { class: "fm-hint", text: "Paste this HTML where the form should appear on your site." }),
        h("button", { class: "btn", type: "button", text: "Copy code", onclick: e => copy(code, e.currentTarget) })));
  }
  function openShare(f, focus) {
    if (!shared()) return localModal();
    const box = h("div");
    const draw = () => { const cur = Data.get("forms", f.id); if (!cur) return m.close(); box.replaceChildren(shareView(full(cur), { onPublish: () => { Data.update("forms", f.id, { published: true }); UI.toast("🚀 Form published"); setTimeout(draw, 30); } })); };
    const m = UI.modal("Share · " + f.name, box, { className: "fm-sharemodal" });
    draw();
    if (focus === "embed") setTimeout(() => { const c = box.querySelector(".fm-code"); if (c) { c.scrollIntoView({ block: "center" }); c.focus(); c.select(); } }, 60);
  }
  async function copyLink(f) {
    if (!shared()) return localModal();
    const ok = await copy(linkFor(f.id));
    if (!ok) return openShare(f);
    if (f.published) UI.toast("🔗 Link copied");
    else UI.toast("🔗 Link copied. The form is a draft: publish it so visitors can open it.", { label: "Publish", run: () => setPublished(f, true) });
  }
  function setPublished(f, on) { Data.update("forms", f.id, { published: on }); UI.toast(on ? "🚀 Form published" : "Form unpublished: its link stops working"); }
  async function duplicate(f) { await saveForm({ ...f, at: 0, name: f.name + " (copy)", published: false, createdBy: Data.me().key }); UI.toast("Form duplicated as a draft"); }
  function removeForm(id) { Data.remove("forms", id); Data.update("settings", META_ID, { [id]: null }); } // null = entry gone (merge can't delete keys)
  async function del(f) {
    if (!(await UI.confirm(`Delete “${f.name}”? Its link stops working. Leads it already brought in stay in the CRM.`))) return;
    removeForm(f.id); UI.toast("Form deleted");
  }

  /* ---------- builder ---------- */
  const PRESETS = [
    ["👤", "Name", { label: "Name", type: "text", map: "name", placeholder: "Your name" }],
    ["@", "Email", { label: "Email", type: "email", map: "email", placeholder: "you@example.com" }],
    ["☎", "Phone", { label: "Phone", type: "tel", map: "phone", placeholder: "+1 555 123 4567" }],
    ["🏢", "Company", { label: "Company", type: "text", map: "companyName", placeholder: "Company name" }],
    ["💬", "Message", { label: "Message", type: "textarea", map: "notes", placeholder: "How can we help?" }],
    null,
    ["Aa", "Short text", { label: "Your question", type: "text", map: "extra" }],
    ["¶", "Long text", { label: "Details", type: "textarea", map: "extra" }],
    ["▾", "Dropdown", { label: "Choose one", type: "select", map: "extra", options: ["Option 1", "Option 2", "Option 3"] }],
    ["☑", "Checkbox", { label: "I agree to be contacted", type: "checkbox", map: "extra" }],
  ];

  function openBuilder(id) {
    const src = id ? Data.get("forms", id) : null;
    if (id && !src) return UI.toast("That form no longer exists");
    const f = JSON.parse(JSON.stringify(src ? full(src) : norm(blank())));
    if (!f.owner) f.owner = Data.me().key;
    let dirty = false, keep = false, openKey = null, dragKey = null, tab = "form", pvRaf = 0;
    const isNew = !id;

    const changed = redrawFields => { dirty = true; if (redrawFields) drawFields(); schedulePv(); };
    const field = (label, ctl, hint) => h("label", { class: "f-row" }, h("span", { text: label }), ctl, hint ? h("small", { class: "fm-hint", text: hint }) : null);
    const text = (key, o = {}) => {
      const el = h(o.area ? "textarea" : "input", { class: "menu-input" + (o.area ? " f-ta" : ""), placeholder: o.placeholder || "", maxlength: o.max || 200, rows: o.rows || null });
      el.value = f[key] || ""; el.oninput = () => { f[key] = el.value; changed(); };
      return el;
    };

    /* fields list */
    const fieldsBox = h("div", { class: "fm-fields" });
    const clearDrop = () => fieldsBox.querySelectorAll(".drop-before,.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
    function move(i, d) { const j = i + d; if (j < 0 || j >= f.fields.length) return; const [x] = f.fields.splice(i, 1); f.fields.splice(j, 0, x); changed(true); }
    function fieldBody(fd, i, lab) {
      const label = h("input", { class: "menu-input", value: fd.label, maxlength: 120, placeholder: "What should people enter?" });
      label.oninput = () => { fd.label = label.value; lab.textContent = fd.label || "Untitled field"; changed(); };
      const type = h("select", { class: "menu-input" }, ...TYPES.map(([k, l]) => h("option", { value: k, selected: fd.type === k }, l)));
      type.onchange = () => {
        fd.type = type.value;
        if (fd.type === "email" && fd.map === "extra") fd.map = "email";
        if (fd.type === "tel" && fd.map === "extra") fd.map = "phone";
        if (fd.type === "select" && !fd.options.length) fd.options = ["Option 1", "Option 2"];
        changed(true);
      };
      const map = h("select", { class: "menu-input" }, ...MAPS.map(([k, l]) => h("option", { value: k, selected: fd.map === k }, l)));
      map.onchange = () => { fd.map = map.value; changed(true); };
      const ph = h("input", { class: "menu-input", value: fd.placeholder, maxlength: 120, placeholder: fd.type === "select" ? "Choose…" : "Hint shown inside the box" });
      ph.oninput = () => { fd.placeholder = ph.value; changed(); };
      const opts = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "One option per line" }); opts.value = fd.options.join("\n");
      opts.oninput = () => { fd.options = opts.value.split("\n").map(s => s.trim()).filter(Boolean); changed(); };
      const req = h("button", { type: "button", class: "switch" + (fd.required ? " on" : ""), role: "switch", "aria-checked": String(fd.required), "aria-label": "Required",
        onclick: () => { fd.required = !fd.required; changed(true); } });
      return h("div", { class: "fm-fbody" },
        field("Label", label),
        h("div", { class: "fm-two" }, field("Type", type), field("Saves to", map)),
        fd.type !== "checkbox" ? field(fd.type === "select" ? "Empty choice text" : "Placeholder", ph) : null,
        fd.type === "select" ? field("Options", opts) : null,
        h("div", { class: "fm-fbar" },
          h("div", { class: "fm-swrow" }, req, h("span", { text: "Required" })), h("span", { class: "grow" }),
          h("button", { class: "icon-btn xs", type: "button", title: "Move up", "aria-label": "Move up", text: "↑", disabled: i === 0, onclick: () => move(i, -1) }),
          h("button", { class: "icon-btn xs", type: "button", title: "Move down", "aria-label": "Move down", text: "↓", disabled: i === f.fields.length - 1, onclick: () => move(i, 1) })));
    }
    function fieldCard(fd, i) {
      const open = openKey === fd.key;
      const lab = h("span", { class: "fm-flabel", text: fd.label || "Untitled field" });
      const head = h("div", { class: "fm-fhead", draggable: true, role: "button", tabindex: 0, "aria-expanded": String(open), title: "Click to edit, drag to reorder",
        onclick: e => { if (e.target.closest("button")) return; openKey = open ? null : fd.key; drawFields(); },
        onkeydown: e => { if ((e.key === "Enter" || e.key === " ") && e.target === head) { e.preventDefault(); openKey = open ? null : fd.key; drawFields(); } } },
        h("span", { class: "fm-grip", html: icon("drag"), "aria-hidden": "true" }),
        h("span", { class: "fm-tic", text: TYPE_IC[fd.type], title: typeName(fd.type) }),
        lab,
        fd.required ? h("span", { class: "fm-pill req", text: "Required" }) : null,
        h("span", { class: "fm-pill", text: "→ " + mapName(fd.map) }),
        h("button", { class: "icon-btn xs", type: "button", title: "Remove field", "aria-label": "Remove field " + (fd.label || ""), html: icon("trash"), onclick: () => { f.fields.splice(i, 1); if (openKey === fd.key) openKey = null; changed(true); } }));
      const card = h("div", { class: "fm-field" + (open ? " open" : ""), dataset: { key: fd.key } }, head, open ? fieldBody(fd, i, lab) : null);
      head.addEventListener("dragstart", e => { dragKey = fd.key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", fd.label || fd.key); card.classList.add("dragging"); });
      head.addEventListener("dragend", () => { dragKey = null; card.classList.remove("dragging"); clearDrop(); });
      card.addEventListener("dragover", e => {
        if (!dragKey || dragKey === fd.key) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        const r = card.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        if (!card.classList.contains(after ? "drop-after" : "drop-before")) { clearDrop(); card.classList.add(after ? "drop-after" : "drop-before"); }
      });
      card.addEventListener("dragleave", e => { if (!card.contains(e.relatedTarget)) card.classList.remove("drop-before", "drop-after"); });
      card.addEventListener("drop", e => {
        if (!dragKey) return;
        e.preventDefault();
        const after = card.classList.contains("drop-after"); clearDrop();
        const from = f.fields.findIndex(x => x.key === dragKey); dragKey = null;
        if (from < 0) return;
        const [mv] = f.fields.splice(from, 1);
        let to = f.fields.findIndex(x => x.key === fd.key); if (to < 0) to = f.fields.length; else if (after) to++;
        f.fields.splice(to, 0, mv); changed(true);
      });
      return card;
    }
    function drawFields() {
      fieldsBox.replaceChildren(...f.fields.map(fieldCard));
      if (!f.fields.length) fieldsBox.append(h("div", { class: "fm-nofields", text: "No fields yet. Add one below." }));
    }
    function addField(preset) {
      if (f.fields.length >= MAX_FIELDS) return UI.toast(`A form can have up to ${MAX_FIELDS} fields`);
      const fd = { key: "f" + uid(), required: false, placeholder: "", options: [], ...JSON.parse(JSON.stringify(preset)) };
      f.fields.push(fd); openKey = fd.key; changed(true);
      setTimeout(() => { const el = fieldsBox.querySelector(`[data-key="${fd.key}"]`); el?.scrollIntoView({ block: "nearest", behavior: "smooth" }); el?.querySelector(".fm-fbody input")?.select(); }, 30);
    }
    const addBtn = h("button", { class: "btn fm-add", type: "button", text: "+ Add field", onclick: e => UI.menu(e.currentTarget,
      [{ section: "Contact details" }, ...PRESETS.map(p => p ? { label: p[1], iconHtml: `<span class="fm-mi">${esc(p[0])}</span>`, onClick: () => addField(p[2]) } : { section: "Your own question" })]) });

    /* CRM settings */
    const targetSeg = h("div", { class: "seg fm-seg", role: "group", "aria-label": "Create in CRM" }, ...[["lead", "🧲 Lead"], ["deal", "💼 Deal + contact"]].map(([k, l]) =>
      h("button", { type: "button", class: f.target === k ? "on" : "", "aria-pressed": String(f.target === k), text: l, onclick: e => {
        f.target = k; targetSeg.querySelectorAll("button").forEach(b => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); }); changed();
      } })));
    const ownerBtn = h("button", { class: "menu-input f-person", type: "button", "aria-label": "Responsible person" });
    const paintOwner = () => { const p = Data.person(f.owner); ownerBtn.replaceChildren(Apps.avatar(p, 20), h("span", { text: p.name + (p.key === Data.me().key ? " (you)" : "") })); };
    ownerBtn.onclick = () => Apps.personPicker(ownerBtn, p => { if (!p) return; f.owner = p.key; paintOwner(); changed(); });
    paintOwner();
    const pubHint = h("small", { class: "fm-hint" });
    const pubSw = h("button", { type: "button", class: "switch", role: "switch", "aria-label": "Published" });
    const paintPub = () => {
      pubSw.classList.toggle("on", f.published); pubSw.setAttribute("aria-checked", String(f.published));
      pubHint.textContent = f.published ? "Anyone with the link can open the form and send it." : "Draft: the link says the form isn't available.";
    };
    pubSw.onclick = () => { f.published = !f.published; paintPub(); changed(); if (tab === "share") drawSide(); };
    paintPub();

    const edit = h("div", { class: "fm-edit" },
      h("section", { class: "fm-sec" }, h("h4", { text: "Form" }),
        field("Name", text("name", { placeholder: "e.g. Website contact form", max: 80 }), "Only your team sees this."),
        field("Title visitors see", text("title", { placeholder: "Get in touch", max: 120 })),
        field("Description", text("desc", { area: true, rows: 2, placeholder: "A line or two about why to fill it in", max: 600 }))),
      h("section", { class: "fm-sec" }, h("h4", null, "Fields ", h("small", { text: "Click to edit · drag to reorder" })), fieldsBox, addBtn),
      h("section", { class: "fm-sec" }, h("h4", { text: "After sending" }),
        field("Button text", text("button", { placeholder: "Send", max: 40 })),
        field("Thank-you message", text("thanks", { area: true, rows: 2, placeholder: "Thanks! We'll be in touch soon.", max: 600 }))),
      h("section", { class: "fm-sec" }, h("h4", { text: "CRM" }),
        h("div", { class: "f-row" }, h("span", { text: "Each answer creates" }), targetSeg),
        h("div", { class: "f-row" }, h("span", { text: "Responsible person" }), ownerBtn, h("small", { class: "fm-hint", text: "Gets the new lead and a notification." })),
        h("div", { class: "fm-pubrow" }, h("div", null, h("b", { text: "Published" }), pubHint), pubSw)));

    /* right side: live preview / thank-you page / share */
    const side = h("div", { class: "fm-side-body" });
    const sideTabs = h("div", { class: "seg fm-seg", role: "tablist" }, ...[["form", "Preview"], ["thanks", "Thank-you page"], ["share", "Share"]].map(([k, l]) =>
      h("button", { type: "button", role: "tab", class: tab === k ? "on" : "", "aria-selected": String(tab === k), dataset: { k }, text: l, onclick: () => setTab(k) })));
    function setTab(k) {
      tab = k;
      sideTabs.querySelectorAll("button").forEach(b => { b.classList.toggle("on", b.dataset.k === k); b.setAttribute("aria-selected", String(b.dataset.k === k)); });
      drawSide();
    }
    function drawSide() {
      cancelAnimationFrame(pvRaf);
      if (tab === "share") return side.replaceChildren(shareView({ ...f, id }, {
        onSave: async () => { if (await save()) drawSide(); },
        onPublish: () => { f.published = true; paintPub(); if (id) Data.update("forms", id, { published: true }); else dirty = true; UI.toast("🚀 Form published"); drawSide(); },
      }));
      side.replaceChildren(h("div", { class: "fm-stage" }, previewCard(f, { mode: tab })));
    }
    const schedulePv = () => { if (tab === "share") return; cancelAnimationFrame(pvRaf); pvRaf = requestAnimationFrame(drawSide); };

    /* phone layout: switch between editing and the preview */
    const builder = h("div", { class: "fm-builder" }, edit, h("div", { class: "fm-side" }, h("div", { class: "fm-side-head" }, sideTabs), side));
    const mtabs = h("div", { class: "seg fm-mtabs" }, ...[["edit", "Edit"], ["side", "Preview & share"]].map(([k, l], i) =>
      h("button", { type: "button", class: i === 0 ? "on" : "", text: l, onclick: e => {
        mtabs.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); builder.classList.toggle("show-side", k === "side"); if (k === "side") drawSide();
      } })));

    async function save() {
      if (!f.fields.length) { UI.toast("Add at least one field"); return false; }
      id = await saveForm(f, id); f.id = id;
      dirty = false;
      return true;
    }
    const saveBtn = h("button", { class: "btn primary", type: "button", text: isNew ? "Create form" : "Save", onclick: async () => {
      saveBtn.disabled = true;
      const created = !src && !f.id;
      const ok = await save(); saveBtn.disabled = false;
      if (!ok) return;
      keep = true; m.close();
      UI.toast(created ? "✨ Form created" : "Form saved");
      if (created && shared()) setTimeout(() => openShare(Data.get("forms", id) ? full(Data.get("forms", id)) : { ...f, id }), 220);
    } });
    const foot = h("div", { class: "fm-foot" },
      id ? h("button", { class: "btn danger", type: "button", text: "Delete", onclick: async () => {
        if (!(await UI.confirm(`Delete “${f.name}”? Its link stops working. Leads it already brought in stay in the CRM.`))) return;
        keep = true; removeForm(id); m.close(); UI.toast("Form deleted");
      } }) : h("span"),
      h("span", { class: "grow" }),
      h("button", { class: "btn", type: "button", text: "Cancel", onclick: async () => {
        if (dirty && !(await UI.confirm("Discard your changes to this form?", "Discard"))) return;
        keep = true; m.close();
      } }),
      saveBtn);

    // closing with Esc or a click outside keeps your work: changes are saved, not thrown away
    const m = UI.modal(isNew ? "New form" : "Edit form", h("div", { class: "fm-bwrap" }, mtabs, builder, foot), {
      className: "fm-modal",
      onClose: () => { if (!keep && dirty) save().then(ok => ok && UI.toast("Changes to “" + (f.name || "form") + "” saved")); },
    });
    drawFields(); drawSide();
    if (isNew) setTimeout(() => edit.querySelector("input")?.select(), 80);
  }

  /* ---------- list (CRM → Forms tab) ---------- */
  function card(f, i) {
    const s = stats(f.id), owner = Data.person(f.owner);
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const more = h("button", { class: "icon-btn", type: "button", title: "More", "aria-label": "More actions for " + f.name, html: icon("dots"), onclick: e => UI.menu(e.currentTarget, [
      { label: "Share & QR code", icon: "link", onClick: () => openShare(f) },
      { label: "Embed code", iconHtml: "<span class=\"fm-mi\">&lt;/&gt;</span>", onClick: () => openShare(f, "embed") },
      { label: f.published ? "Unpublish" : "Publish", iconHtml: `<span class="fm-mi">${f.published ? "⏸" : "🚀"}</span>`, onClick: () => setPublished(f, !f.published) },
      { label: "Duplicate", icon: "copy", onClick: () => duplicate(f) },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, onClick: () => del(f) }], { align: "end" }) });
    return h("article", { class: "fm-card glass" + (f.published ? "" : " draft"), style: { animationDelay: Math.min(i, 8) * 45 + "ms" } },
      h("button", { class: "fm-card-top", type: "button", title: "Edit form", onclick: () => openBuilder(f.id) },
        h("span", { class: "fm-card-ic", text: f.target === "deal" ? "💼" : "🧲" }),
        h("span", { class: "fm-card-t" }, h("b", { text: f.name }), h("small", { text: f.title || "No title" })),
        h("span", { class: "fm-status" + (f.published ? " on" : ""), text: f.published ? "Published" : "Draft" })),
      h("div", { class: "fm-card-stats" },
        h("span", { class: "fm-stat big" }, h("b", { text: String(s.leads + s.deals) }), h("small", { text: s.deals && !s.leads ? (s.deals === 1 ? "deal" : "deals") : s.leads + s.deals === 1 ? "lead" : "leads" })),
        h("span", { class: "fm-stat-list" },
          h("span", { text: s.last ? "🕒 Last answer " + UI.timeAgo(s.last) : "🕒 No answers yet" }),
          h("span", { text: `📝 ${plural(f.fields.length, "field")} · creates a ${f.target === "deal" ? "deal" : "lead"}` }),
          h("span", { class: "who" }, Apps.avatar(owner, 18), owner.name))),
      h("div", { class: "fm-card-acts" },
        h("button", { class: "btn", type: "button", text: "Edit", onclick: () => openBuilder(f.id) }),
        h("button", { class: "btn", type: "button", text: "🔗 Copy link", onclick: () => copyLink(f) }),
        h("button", { class: "btn", type: "button", text: "Preview", onclick: () => openPreview(f) }),
        h("span", { class: "grow" }), more));
  }

  function render(root) {
    const wrap = h("div", { class: "fm" });
    root.replaceChildren(wrap);
    function draw() {
      const forms = liveForms();
      const leads = forms.reduce((a, f) => { const s = stats(f.id); return a + s.leads + s.deals; }, 0);
      const newBtn = () => h("button", { class: "btn primary", type: "button", text: "+ New form", onclick: () => openBuilder() });
      wrap.replaceChildren(
        h("div", { class: "fm-head" },
          h("div", { class: "fm-head-t" }, h("h2", { text: "Web forms" }),
            h("p", { text: forms.length ? `${forms.length} form${forms.length === 1 ? "" : "s"} · ${forms.filter(f => f.published).length} published · ${leads} lead${leads === 1 ? "" : "s"} received` : "Share a link, print a QR code or put a form on your website. Every answer arrives here as a lead." })),
          newBtn()),
        !shared() ? localNote() : null,
        forms.length ? h("div", { class: "fm-grid" }, ...forms.map(card))
          : Apps.empty("🧲", "No forms yet. Make one and every answer lands in your CRM as a new lead.", newBtn()));
    }
    const redraw = UI.liveDraw(wrap, draw);
    const offs = ["settings", "forms", "leads", "deals"].map(c => Data.on(c, redraw));
    offs.push(Data.on("forms", migrate));
    const tick = setInterval(redraw, 60000); // keep "Last answer 5m ago" fresh
    return () => { offs.forEach(off => off()); clearInterval(tick); };
  }

  /* ---------- answers → CRM leads (runs on every signed-in member's device) ----------
     The public page writes workspaces/{ws}/formsubs/{id} = { form, values, at, page }. Whoever sees it first claims it,
     waits a moment, and only goes on if the claim is still theirs, so two devices never both create the lead.
     Record ids are derived from the submission id, so even a retry after a crash can't make a duplicate. */
  const STALE = 30000, SETTLE = 1500;
  const proc = { offs: [], busy: new Set(), timer: 0, since: 0 };
  const val = v => typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().slice(0, 5000) : "";

  function startProcessor() {
    proc.offs.forEach(off => off()); proc.offs = []; clearInterval(proc.timer); proc.busy.clear();
    if (!shared()) return; // never in a private workspace: there is no public page for it
    proc.since = Date.now();
    proc.offs = [Data.on("forms", () => {}), Data.on("settings", () => {}), Data.on("formsubs", sweep)];
    proc.timer = setInterval(() => sweep(Data.list("formsubs")), 15000); // picks up claims left behind by a closed device
  }
  function sweep(subs) {
    if (!shared()) return;
    const now = Date.now();
    (subs || []).forEach(s => {
      if (proc.busy.has(s.id)) return;
      if (s.claimed && now - (+s.claimedAt || 0) < STALE) return; // someone (maybe another tab) is on it
      if (!s.form || typeof s.values !== "object" || !s.values) { Data.remove("formsubs", s.id); return; } // leftover of a claim on a deleted answer
      if ((!Data.get("forms", s.form) || !metaOf(s.form).owner) && now - proc.since < 10000) return; // forms / settings still loading: try again shortly
      claim(s);
    });
  }
  async function claim(s) {
    const me = Data.me().key, ws = Cloud.ws.id, ts = Date.now();
    proc.busy.add(s.id);
    try {
      await Data.update("formsubs", s.id, { claimed: me, claimedAt: ts });
      await sleep(SETTLE);
      const cur = Data.get("formsubs", s.id);
      if (!shared() || Cloud.ws.id !== ws || !cur || cur.claimed !== me || cur.claimedAt !== ts || !cur.form || !cur.values) return;
      await toCrm(cur, me);
      await Data.remove("formsubs", s.id);
    } catch (e) { console.warn("Web form answer", s.id, e); }
    finally { setTimeout(() => proc.busy.delete(s.id), 2000); }
  }
  async function toCrm(sub, me) {
    const raw = Data.get("forms", sub.form);
    const form = raw ? full(raw) : norm({ ...metaOf(sub.form), name: metaOf(sub.form).name || "a deleted form", fields: [] });
    const values = sub.values || {}, rec = { name: "", companyName: "", email: "", phone: "" }, notes = [], extra = [], preview = [], used = new Set();
    form.fields.forEach(fd => {
      if (!(fd.key in values)) return;
      used.add(fd.key);
      const v = fd.type === "checkbox" ? (values[fd.key] === true || values[fd.key] === "true" || values[fd.key] === "on" ? "Yes" : "No") : val(values[fd.key]);
      if (!v) return;
      const label = fd.label || fd.key;
      preview.push(`${label}: ${v}`);
      const m = fd.map || "extra";
      if (fd.type !== "checkbox" && m === "name") rec.name = rec.name ? rec.name + " " + v : v; // first + last name fields
      else if (fd.type !== "checkbox" && ["companyName", "email", "phone"].includes(m) && !rec[m]) rec[m] = v;
      else if (fd.type !== "checkbox" && m === "notes") notes.push(v);
      else extra.push(`${label}: ${v}`);
    });
    // answers to fields that were removed from the form meanwhile: keep them too
    Object.keys(values).filter(k => !used.has(k)).slice(0, 40).forEach(k => { const v = val(values[k]); if (v) { extra.push(`${k}: ${v}`); preview.push(`${k}: ${v}`); } });
    const name = (rec.name || rec.email || rec.phone || "Web form visitor").slice(0, 200);
    const page = typeof sub.page === "string" ? sub.page.slice(0, 500) : "";
    const notesText = [...notes, extra.join("\n"), page ? "Sent from: " + page : ""].filter(Boolean).join("\n\n");
    const people = Data.people().map(p => p.key);
    const owner = [form.owner, form.createdBy, me].find(k => k && people.includes(k)) || me;
    const now = Date.now(), at = +sub.at > now - 7 * 864e5 && +sub.at <= now ? +sub.at : now;
    const act = [{ kind: "note", text: `Sent the web form “${form.name}”`, by: me, at: now }];
    const rid = "wf" + sub.id;
    let kind = "lead";
    if (form.target === "deal") {
      kind = "deal";
      let company = "";
      if (rec.companyName) company = Data.list("companies").find(c => !c.deleted && String(c.name || "").toLowerCase() === rec.companyName.toLowerCase())?.id
        || await Data.add("companies", { name: rec.companyName, owner, activities: [] }, "wfc" + sub.id);
      const contact = await Data.add("contacts", { name, email: rec.email, phone: rec.phone, company, owner, source: "Web form", form: sub.form, notes: notesText, activities: [] }, rid);
      await Data.add("deals", { title: `${name} · ${form.name}`.slice(0, 200), amount: 0, stage: "new", pipeline: "default", contact, company, owner, source: "Web form", form: sub.form, notes: notesText, activities: act, at }, rid);
    } else {
      await Data.add("leads", { name, companyName: rec.companyName, email: rec.email, phone: rec.phone, source: "Web form", status: "new", owner, value: 0, notes: notesText, form: sub.form, activities: act, at }, rid);
    }
    // written directly (not Data.notify) so the owner hears about it even when this device is theirs
    await Data.add("notifications", { to: owner, text: `🧲 New ${kind} from <b>${esc(form.name)}</b>: ${esc(name)}`, link: "#/app/crm", read: false, body: preview.join("\n").slice(0, 300) }, "wfn" + sub.id);
  }

  Apps.onWorkspace.add(startProcessor);

  /* ---------- QR code: byte mode, error correction M, versions 1–10, drawn as SVG (no library, no service) ---------- */
  const QR = (() => {
    const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // per version, level M
    const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
    const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];
    const bit = (x, i) => ((x >>> i) & 1) !== 0;
    const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
    function rsDivisor(deg) {
      const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
      for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
      return r;
    }
    function rsRemainder(data, div) {
      const r = div.map(() => 0);
      for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => (r[i] ^= gmul(c, f))); }
      return r;
    }
    function formatBits(mask) { const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((d << 10) | r) ^ 0x5412; } // level M = 00
    function versionBits(v) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); return (v << 12) | r; }
    function alignment(v) {
      if (v === 1) return [];
      const n = Math.floor(v / 7) + 2, size = v * 4 + 17, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, out = [6];
      for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
      return out;
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => (((x + y) % 2) + (x * y) % 3) % 2 === 0];
    function penalty(m, n) {
      let p = 0, dark = 0;
      const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
        const get = b => pass ? m[b][a] : m[a][b];
        let run = 1;
        for (let b = 1; b < n; b++) { if (get(b) === get(b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
        for (let b = 0; b + 11 <= n; b++) for (const pat of [A, B]) { let ok = true; for (let k = 0; k < 11 && ok; k++) ok = get(b + k) === !!pat[k]; if (ok) p += 40; }
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (m[y][x]) dark++;
        if (x < n - 1 && y < n - 1) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
      }
      const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;
      return p + Math.max(0, k) * 10;
    }
    function matrix(text) {
      const bytes = [...new TextEncoder().encode(String(text))];
      let v = 1;
      while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++;
      if (v > 10) return null;
      // data bits: mode, length, bytes, terminator, padding
      const cap = dataCodewords(v) * 8, bits = [];
      const put = (x, len) => { for (let i = len - 1; i >= 0; i--) bits.push((x >>> i) & 1); };
      put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
      put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
      for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
      const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
      // error correction blocks, interleaved
      const nb = BLOCKS[v], el = ECC[v], raw = Math.floor(rawModules(v) / 8), short = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [];
      for (let i = 0, k = 0; i < nb; i++) {
        const d = data.slice(k, k + shortLen - el + (i < short ? 0 : 1)); k += d.length;
        const e = rsRemainder(d, div); if (i < short) d.push(0); blocks.push(d.concat(e));
      }
      const cw = [];
      for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= short) cw.push(b[i]); });
      // function patterns
      const n = v * 4 + 17, mod = [...Array(n)].map(() => Array(n).fill(false)), fn = [...Array(n)].map(() => Array(n).fill(false));
      const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
      for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
      const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4); } };
      finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
      const ap = alignment(v), na = ap.length;
      for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
      const drawFormat = mask => {
        const b = formatBits(mask);
        for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
        set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
        for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
        for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(b, i));
        for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(b, i));
        set(8, n - 8, true); // dark module
      };
      drawFormat(0);
      if (v >= 7) { const b = versionBits(v); for (let i = 0; i < 18; i++) { const a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); } }
      // codewords in the zigzag order
      let i = 0;
      for (let right = n - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
          const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
          if (!fn[y][x] && i < cw.length * 8) { mod[y][x] = bit(cw[i >>> 3], 7 - (i & 7)); i++; }
        }
      }
      // pick the mask that reads best
      const applyMask = k => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[k](x, y)) mod[y][x] = !mod[y][x]; };
      let best = 0, bestP = Infinity;
      for (let k = 0; k < 8; k++) { applyMask(k); drawFormat(k); const p = penalty(mod, n); if (p < bestP) { bestP = p; best = k; } applyMask(k); }
      applyMask(best); drawFormat(best);
      return { version: v, size: n, mask: best, modules: mod };
    }
    function svg(text, px = 240) {
      const q = matrix(text); if (!q) return "";
      const quiet = 4, n = q.size + quiet * 2;
      let d = "";
      q.modules.forEach((row, y) => { for (let x = 0; x < q.size; x++) { if (!row[x]) continue; let len = 1; while (x + len < q.size && row[x + len]) len++; d += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`; x += len - 1; } });
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#15131f"/></svg>`;
    }
    return { matrix, svg, rsDivisor, rsRemainder, formatBits, versionBits };
  })();

  Apps.Forms = { render, openBuilder, openShare, qr: QR.svg, qrMatrix: QR.matrix, _qr: QR };
})();
